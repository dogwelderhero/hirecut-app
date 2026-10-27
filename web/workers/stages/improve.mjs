/**
 * Stage 3 — Improve the resume from the gaps the job matching found.
 *
 *   Collecting gaps from your top jobs        → gaps merged across scored jobs,
 *                                               each with its verified posting line
 *   Finding proof in your experience          → the resume and gaps handed to the model
 *   Writing changes for each gap              → model output validated: applies to
 *                                               its section, names known gaps
 *   Checking every change against your resume → each replacement passes the fact check
 *
 * A gap the resume has no proof for is NOT turned into a change; it stays in
 * the result as a gap, which the recruiter step picks up. Artifacts and checks
 * happen before `stage.result`, as in every other stage.
 */

import { readFile } from "node:fs/promises";

import { ModelError, requestStructured, untrusted } from "../../src/lib/hirecute/model.mjs";
import { IMPROVE_SCHEMA, improveSystem, improveUser } from "../../src/lib/hirecute/prompts.mjs";
import { checkFacts } from "../../src/lib/hirecute/documents.mjs";
import { applyRecommendation } from "../../src/lib/hirecute/resume.mjs";
import { collectGaps } from "../../src/lib/hirecute/evidence.mjs";
import { ACTION_LABELS } from "../../src/lib/hirecute/action-labels.mjs";

/** Gaps handed to the model; more than this is noise, not focus. */
const MAX_GAPS = 12;
const MAX_RECOMMENDATIONS = 10;

function actionRecord(index, label) {
  return {
    id: `improve-${index}`,
    stage: "improve",
    label,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

const publicError = (code, message, retryable) => ({ code, message, retryable, stage: "improve", jobId: null });

/**
 * @param {object} ctx
 * @param {(type: string, payload: unknown, stage?: string|null) => void} ctx.emit
 * @param {(entry: unknown) => void} ctx.diag
 * @param {string} ctx.runDir
 * @param {string} ctx.codeRoot
 * @param {object} ctx.resume         The resume as read (stage 1).
 * @param {object[]} ctx.jobs         Real jobs from discovery.
 * @param {object[]} ctx.assessments  Validated assessments with verified quotes.
 * @param {string} ctx.sourceFactsPath
 */
export async function runImproveStage(ctx) {
  const { emit, diag, runDir, codeRoot, resume, jobs, assessments, sourceFactsPath } = ctx;
  const labels = ACTION_LABELS.improve;
  const done = (i) => emit("action.completed", { stage: "improve", actionId: `improve-${i}` }, "improve");

  emit("stage.started", { stage: "improve", inputVersion: 1, attempt: 1 }, "improve");

  // ── Action 1: gaps across the scored jobs ──────────────────────────────
  emit("action.started", { action: actionRecord(0, labels[0]) }, "improve");
  const gaps = collectGaps(assessments, jobs).slice(0, MAX_GAPS);
  diag({ gaps: { count: gaps.length } });
  done(0);

  // ── Action 2: hand the resume and the gaps to the model ────────────────
  emit("action.started", { action: actionRecord(1, labels[1]) }, "improve");

  let raw = [];
  let recommendationsAvailable = true;
  if (gaps.length > 0) {
    try {
      const response = await requestStructured({
        system: await improveSystem(codeRoot),
        user: improveUser({
          resumeJson: untrusted("STRUCTURED RESUME", JSON.stringify(resume, null, 2)),
          gapsJson: untrusted(
            "GAPS",
            JSON.stringify(
              gaps.map((g) => ({
                id: g.id,
                requirement: g.requirement,
                importance: g.importance,
                askedBy: g.jobs.length,
                postingLine: g.jobs[0]?.jobQuote,
                resumeLine: g.jobs.find((j) => j.resumeQuote)?.resumeQuote ?? null,
              })),
              null,
              2,
            ),
          ),
        }),
        schema: IMPROVE_SCHEMA,
        schemaName: "emit_gap_recommendations",
        maxTokens: 4096,
      });
      diag({ model: { call: "emit_gap_recommendations", usage: response.usage, model: response.model } });
      raw = Array.isArray(response.data?.recommendations) ? response.data.recommendations : [];
    } catch (err) {
      // A failed pass is not a failed step: the gaps and their evidence still show.
      recommendationsAvailable = false;
      diag({
        modelError: {
          call: "emit_gap_recommendations",
          code: err instanceof ModelError ? err.code : "unknown",
          detail: err?.detail ?? String(err?.message ?? err),
        },
      });
    }
  }
  done(1);

  // ── Action 3: keep only changes that apply and answer a known gap ──────
  emit("action.started", { action: actionRecord(2, labels[2]) }, "improve");
  const known = new Set(gaps.map((g) => g.id));
  const seen = new Set();
  const candidates = [];
  for (const r of raw) {
    if (candidates.length >= MAX_RECOMMENDATIONS) break;
    const rec = {
      id: `gaprec-${candidates.length + 1}`,
      section: String(r?.section ?? ""),
      kind: ["clarity", "structure", "formatting", "relevance"].includes(r?.kind) ? r.kind : "relevance",
      label: String(r?.label ?? "").trim().slice(0, 60) || "Suggested edit",
      explanation: String(r?.explanation ?? "").trim(),
      before: String(r?.before ?? ""),
      after: String(r?.after ?? "").trim(),
      gapIds: (Array.isArray(r?.gapIds) ? r.gapIds : []).map(String).filter((id) => known.has(id)),
    };
    const key = `${rec.section}\u0000${rec.before}`;
    if (rec.gapIds.length === 0) {
      diag({ droppedRecommendation: { reason: "no_known_gap", section: rec.section } });
      continue;
    }
    if (seen.has(key) || !applyRecommendation(resume, rec)) {
      diag({ droppedRecommendation: { reason: "does_not_apply", section: rec.section } });
      continue;
    }
    seen.add(key);
    candidates.push(rec);
  }
  done(2);

  // ── Action 4: fact-check every replacement against the source ──────────
  emit("action.started", { action: actionRecord(3, labels[3]) }, "improve");
  const recommendations = [];
  for (const rec of candidates) {
    const facts = await checkFacts({ codeRoot, runDir, text: rec.after, sourcePath: sourceFactsPath });
    if (!facts.ran || facts.flags.length > 0) {
      diag({ droppedRecommendation: { reason: "fact_check", section: rec.section, flags: facts.flags } });
      continue;
    }
    recommendations.push(rec);
  }
  diag({ improve: { gaps: gaps.length, asked: raw.length, kept: recommendations.length } });
  done(3);

  // Make sure the source file is still there: if the run directory vanished,
  // the result would point at evidence that no longer exists.
  try {
    await readFile(sourceFactsPath, "utf8");
  } catch {
    const error = publicError("internal_error", "We lost track of your resume. Please start again.", true);
    emit("stage.error", { stage: "improve", inputVersion: 1, error }, "improve");
    return { ok: false };
  }

  emit(
    "stage.result",
    {
      stage: "improve",
      inputVersion: 1,
      result: { kind: "improve", recommendations, gaps, recommendationsAvailable },
    },
    "improve",
  );
  return { ok: true, recommendations, gaps };
}
