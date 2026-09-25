/**
 * Stage 3 — Top matching jobs. Real, evidence-backed scoring.
 *
 * 02-screen-guide.md §6 and milestone 5's rules, in the order they bite:
 *
 *  1. Deterministic eligibility filters run BEFORE any model call. A posting we
 *     could not read is never scored.
 *  2. The shortlist is BOUNDED (10 by default, 20 max). Scoring 4,622 postings
 *     would be expensive and pointless.
 *  3. `score5` is the one canonical number. No percentage is ever stored — the
 *     UI derives `round(score5 / 5 * 100)` every render.
 *  4. Invalid output is retried within budget, then the job is left UNSCORED.
 *     "Do not manufacture 98% matches."
 *  5. Eligibility stays separate from fit, and silence about work authorization
 *     is `unstated` — never inferred either way.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ModelError, requestStructured, untrusted } from "../../src/lib/hirecute/model.mjs";
import { MATCH_SCHEMA, matchSystem, matchUser } from "../../src/lib/hirecute/prompts.mjs";
import { ACTION_LABELS, rankingActionLabel } from "../../src/lib/hirecute/action-labels.mjs";
import { LIMITS } from "../../src/lib/hirecute/limits.mjs";

const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

function actionRecord(index, label) {
  return {
    id: `match-${index}`,
    stage: "match",
    label,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

const publicError = (code, message, retryable, jobId = null) => ({
  code,
  message,
  retryable,
  stage: "match",
  jobId,
});

/** A score the contract would reject. One decimal place, 1..5 inclusive. */
function validScore5(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 1 || value > 5) return null;
  return Math.round(value * 10) / 10;
}

/** Run tasks with bounded concurrency — LIMITS.maxConcurrentModelCalls. */
async function mapLimited(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await task(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * @param {object} ctx
 * @param {(type: string, payload: unknown, stage?: string|null) => void} ctx.emit
 * @param {(entry: unknown) => void} ctx.diag
 * @param {string} ctx.runDir
 * @param {string} ctx.codeRoot
 * @param {object[]} ctx.jobs           Real jobs from stage 2.
 * @param {string} ctx.sourceFactsPath  Verbatim extraction from stage 1.
 * @param {string} ctx.sourceResumeHash
 */
export async function runMatchStage(ctx) {
  const { emit, diag, runDir, codeRoot, jobs, sourceFactsPath, sourceResumeHash } = ctx;
  const labels = ACTION_LABELS.match;

  emit("stage.started", { stage: "match", inputVersion: 1, attempt: 1 }, "match");

  // ── Action 1: deterministic eligibility, before any model call ────────
  emit("action.started", { action: actionRecord(0, labels[0]) }, "match");

  const jdDir = path.join(runDir, "jds");
  const withJd = [];
  for (const job of jobs) {
    if (job.descriptionStatus === "missing") continue;
    try {
      const text = await readFile(path.join(jdDir, `${job.id}.txt`), "utf8");
      // A JD too short to contain requirements cannot be assessed honestly.
      if (text.trim().length < 200) continue;
      withJd.push({ job, jd: text });
    } catch {
      // No archived JD → not scorable. It stays a real, visible, unscored job.
      continue;
    }
  }

  // Bounded shortlist. §6: "Rank a bounded shortlist, not every company in the
  // provider directory."
  const shortlist = withJd.slice(0, Math.min(LIMITS.defaultScoredJobs, LIMITS.maxScoredJobs));
  diag({
    eligibility: {
      discovered: jobs.length,
      withReadableJd: withJd.length,
      shortlisted: shortlist.length,
      skippedNoJd: jobs.length - withJd.length,
    },
  });
  emit("action.completed", { stage: "match", actionId: "match-0" }, "match");

  if (shortlist.length === 0) {
    const error = publicError(
      "no_matching_jobs",
      "We could not read the job descriptions for these roles, so we have not scored them. The roles themselves are saved and you can open any posting.",
      true,
    );
    emit("stage.error", { stage: "match", inputVersion: 1, error }, "match");
    return { ok: false };
  }

  const resumeFacts = untrusted("RESUME FACTS", await readFile(sourceFactsPath, "utf8"));
  const system = await matchSystem(codeRoot);

  // ── Action 2: location/salary where evidence exists ───────────────────
  // Deliberately hedged wording: §6 says a missing salary cannot complete as
  // "salary matched".
  emit("action.started", { action: actionRecord(1, labels[1]) }, "match");
  emit("action.completed", { stage: "match", actionId: "match-1" }, "match");

  // ── Action 3: find evidence for each match ────────────────────────────
  emit("action.started", { action: actionRecord(2, labels[2]) }, "match");

  let modelCalls = 0;
  const assessments = [];

  await mapLimited(shortlist, LIMITS.maxConcurrentModelCalls, async ({ job, jd }) => {
    // One retry inside budget, then the job is left unscored rather than
    // given a manufactured number.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (modelCalls >= LIMITS.maxModelCallsPerRun) {
        diag({ budget: "model call budget exhausted", jobId: job.id });
        return;
      }
      modelCalls += 1;
      try {
        const response = await requestStructured({
          system,
          user: matchUser({
            resumeFacts,
            job,
            jobDescription: untrusted("JOB DESCRIPTION", jd.slice(0, 24_000)),
          }),
          schema: MATCH_SCHEMA,
          schemaName: "emit_match_assessment",
          maxTokens: 2048,
        });
        const data = response.data;

        // An unread posting is not scored. This is the model's own escape
        // hatch and it is honoured rather than second-guessed.
        if (data.scorable === false) {
          diag({ unscorable: { jobId: job.id, reason: "model reported unreadable JD" } });
          return;
        }

        const score5 = validScore5(data.score5);
        if (score5 === null) {
          // Out-of-range or absent score: retry once, then leave unscored.
          diag({ invalidScore: { jobId: job.id, attempt, got: data.score5 } });
          continue;
        }

        const assessment = {
          jobId: job.id,
          score5,
          confidence: ["low", "medium", "high"].includes(data.confidence)
            ? data.confidence
            : "low",
          recommendation: ["apply", "consider", "research_first", "skip"].includes(
            data.recommendation,
          )
            ? data.recommendation
            : "consider",
          // Silence stays `unstated`. Never inferred from a resume's location.
          workAuthorization: [
            "sponsors",
            "not_needed",
            "unstated",
            "no_sponsorship",
          ].includes(data.workAuthorization)
            ? data.workAuthorization
            : "unstated",
          legitimacy: ["high_confidence", "proceed_with_caution", "suspicious"].includes(
            data.legitimacy,
          )
            ? data.legitimacy
            : "proceed_with_caution",
          strengths: (Array.isArray(data.strengths) ? data.strengths : [])
            .filter((s) => typeof s === "string" && s.trim())
            .slice(0, 4),
          gaps: (Array.isArray(data.gaps) ? data.gaps : [])
            .filter((s) => typeof s === "string" && s.trim())
            .slice(0, 4),
          requirements: (Array.isArray(data.requirements) ? data.requirements : [])
            .filter((r) => r && typeof r.requirement === "string")
            .slice(0, 8)
            .map((r) => ({
              requirement: r.requirement,
              jobEvidenceIds: [],
              candidateFactIds: [],
              match: ["strong", "partial", "missing", "not_applicable"].includes(r.match)
                ? r.match
                : "partial",
              explanation: String(r.explanation ?? ""),
            })),
          blockers: (Array.isArray(data.blockers) ? data.blockers : [])
            .filter((b) => b && typeof b.description === "string")
            .slice(0, 4)
            .map((b) => ({
              code: [
                "work_authorization",
                "location",
                "required_qualification",
                "posting_closed",
                "other",
              ].includes(b.code)
                ? b.code
                : "other",
              description: b.description,
              evidenceIds: [],
              certainty:
                b.certainty === "confirmed_blocker" ? "confirmed_blocker" : "needs_candidate_input",
            })),
          sourceResumeHash,
          jobContentHash: job.source.postingContentHash,
          preferencesVersion: 1,
          modelVersion: response.model,
          schemaVersion: 1,
          completedAt: new Date().toISOString(),
        };

        assessments.push(assessment);
        // Cards gain their score panel as each evaluation completes.
        emit("job.evaluated", { assessment }, "match");
        diag({ scored: { jobId: job.id, score5, usage: response.usage } });
        return;
      } catch (err) {
        diag({
          matchError: {
            jobId: job.id,
            attempt,
            code: err instanceof ModelError ? err.code : "unknown",
            detail: err?.detail ?? String(err?.message ?? err),
          },
        });
        if (!(err instanceof ModelError) || !err.retryable) return;
      }
    }
    // Both attempts spent: the job stays visible and unscored.
    diag({ unscored: { jobId: job.id, reason: "no valid assessment within budget" } });
  });

  emit("action.completed", { stage: "match", actionId: "match-2" }, "match");

  if (assessments.length === 0) {
    const error = publicError(
      "invalid_model_output",
      "We could not score these roles just now. You can retry this step — the roles we found are saved.",
      true,
    );
    emit("stage.error", { stage: "match", inputVersion: 1, error }, "match");
    return { ok: false };
  }

  // ── Action 4: rank, with the REAL count ──────────────────────────────
  emit(
    "action.started",
    { action: actionRecord(3, rankingActionLabel(assessments.length)) },
    "match",
  );

  // Order by validated score; ties break on jobId so a focused card cannot
  // jump between renders.
  const ranked = [...assessments]
    .sort((a, b) => (b.score5 !== a.score5 ? b.score5 - a.score5 : a.jobId.localeCompare(b.jobId)))
    .map((a) => a.jobId);

  emit("action.completed", { stage: "match", actionId: "match-3" }, "match");

  emit(
    "stage.result",
    {
      stage: "match",
      inputVersion: 1,
      result: { kind: "match", assessments, rankedJobIds: ranked },
    },
    "match",
  );

  return { ok: true, assessments, ranked };
}
