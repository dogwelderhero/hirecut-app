/**
 * Stage 1 — Finetune Resume. Real work.
 *
 * 02-screen-guide.md §4 maps four visible actions onto four completion
 * conditions, and this file exists to honour them exactly: each action is
 * marked complete only when its condition actually holds.
 *
 *   Reading your resume                      → extraction produced usable text
 *   Extracting your experience and skills    → resume read into sections, verbatim,
 *                                              fact-checked, published (resume.parsed)
 *   Refining your summary and bullet points  → per-section recommendations, each
 *                                              shown to apply and fact-checked
 *   Checking formatting and readability      → base payload validates, CV built
 *                                              (HTML only while PDF is disabled)
 *
 * Ordering rule from §2: "A validated result is written to the server store
 * before its result event." So artifacts land on disk, then `stage.result` is
 * emitted. Never the other way round.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

import { extractResumeText, extractionMessage } from "../../src/lib/hirecute/extract.mjs";
import { ModelError, requestStructured, untrusted } from "../../src/lib/hirecute/model.mjs";
import {
  RESUME_PARSE_SCHEMA,
  RESUME_RECOMMENDATIONS_SCHEMA,
  resumeParseSystem,
  resumeParseUser,
  resumeRecommendationSystem,
  resumeRecommendationUser,
} from "../../src/lib/hirecute/prompts.mjs";
import { buildCvDocument, checkFacts, sourceFactsMarkdown } from "../../src/lib/hirecute/documents.mjs";
import {
  SECTION_KEYS,
  applyRecommendation,
  isSectionEmpty,
  normalizeResume,
  resumeText,
  toCvPayload,
} from "../../src/lib/hirecute/resume.mjs";
import { ACTION_LABELS } from "../../src/lib/hirecute/action-labels.mjs";

const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

function actionRecord(index, label) {
  return {
    id: `refine-${index}`,
    stage: "refine",
    label,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

function publicError(code, message, retryable) {
  return { code, message, retryable, stage: "refine", jobId: null };
}

/** Find the preserved original, whatever extension it was stored under. */
async function findOriginal(runDir) {
  const dir = path.join(runDir, "originals");
  const entries = await readdir(dir).catch(() => []);
  const hit = entries.find((f) => /^resume\.(pdf|docx|txt)$/i.test(f));
  return hit ? path.join(dir, hit) : null;
}

/**
 * @param {object} ctx
 * @param {(type: string, payload: unknown, stage?: string|null) => void} ctx.emit
 * @param {(entry: unknown) => void} ctx.diag
 * @param {string} ctx.runDir
 * @param {string} ctx.codeRoot
 * @param {Record<string,string>} ctx.env
 * @returns {Promise<{ok: true, searchSeed: object, sourceFactsPath: string} | {ok: false}>}
 */
export async function runRefineStage(ctx) {
  const { emit, diag, runDir, codeRoot, env, onParsed } = ctx;
  const labels = ACTION_LABELS.refine;

  emit("stage.started", { stage: "refine", inputVersion: 1, attempt: 1 }, "refine");

  // ── Action 1: read the resume ──────────────────────────────────────────
  emit("action.started", { action: actionRecord(0, labels[0]) }, "refine");

  const originalPath = await findOriginal(runDir);
  if (!originalPath) {
    emit("action.error", {
      stage: "refine",
      actionId: "refine-0",
      error: publicError("invalid_upload", "We could not find your uploaded file.", false),
    }, "refine");
    emit("stage.error", {
      stage: "refine",
      inputVersion: 1,
      error: publicError("invalid_upload", "We could not find your uploaded file.", false),
    }, "refine");
    return { ok: false };
  }

  const bytes = await readFile(originalPath);
  const extracted = await extractResumeText(bytes);
  if (!extracted.ok) {
    // §4: "Extraction failure: keep the received-file receipt, explain what
    // could not be read, allow replacement." The original stays on disk.
    diag({ extraction: { reason: extracted.reason, detail: extracted.detail } });
    const error = publicError("unreadable_resume", extractionMessage(extracted.reason), true);
    emit("action.error", { stage: "refine", actionId: "refine-0", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  // The verbatim extraction is the source of truth the fact checker compares
  // against. Written BEFORE the model sees anything, so a later rewrite cannot
  // become its own evidence.
  const sourceFactsPath = path.join(runDir, "source-facts.md");
  await writeFile(sourceFactsPath, sourceFactsMarkdown(extracted.text), "utf8");
  const sourceResumeHash = sha256(extracted.text);

  diag({ extraction: { chars: extracted.text.length, pages: extracted.pages, truncated: extracted.truncated } });
  emit("action.completed", { stage: "refine", actionId: "refine-0" }, "refine");

  // ── Action 2: read the resume into sections (no rewriting) ─────────────
  emit("action.started", { action: actionRecord(1, labels[1]) }, "refine");

  /** One structured call. Returns `{data}` or `{error}` (public) — never throws. */
  async function call(opts) {
    try {
      const response = await requestStructured(opts);
      diag({ model: { call: opts.schemaName, usage: response.usage, model: response.model } });
      return { data: response.data };
    } catch (err) {
      diag({ modelError: { call: opts.schemaName, detail: err?.detail ?? String(err?.message ?? err) } });
      return {
        error: publicError(
          err instanceof ModelError ? err.code : "internal_error",
          err instanceof ModelError ? err.message : "We could not read your resume just now.",
          err instanceof ModelError ? err.retryable : true,
        ),
      };
    }
  }

  const parsed = await call({
    tier: "fast",
    system: await resumeParseSystem(),
    user: resumeParseUser(untrusted("RESUME", extracted.text)),
    schema: RESUME_PARSE_SCHEMA,
    schemaName: "emit_resume_sections",
    maxTokens: 8192,
  });
  if (parsed.error) {
    emit("action.error", { stage: "refine", actionId: "refine-1", error: parsed.error }, "refine");
    // §4: "Model/validation failure: show original and retry." The original is untouched.
    emit("stage.error", { stage: "refine", inputVersion: 1, error: parsed.error }, "refine");
    return { ok: false };
  }

  // Validation, not trust: coerce to the section shape, and require that the
  // document actually had resume content in it. A reply wrapped one level too
  // deep ({x: {usable, sections}}) is unwrapped rather than read as empty.
  let parseData = parsed.data ?? {};
  if (parseData.usable === undefined && !parseData.sections) {
    const inner = Object.values(parseData).find((v) => v && typeof v === "object" && ("usable" in v || "sections" in v));
    if (inner) parseData = inner;
  }
  const resume = normalizeResume(parseData.sections ?? parseData.resume);
  diag({ parse: { keys: Object.keys(parseData), usable: parseData.usable ?? null } });
  if (parseData.usable === false || SECTION_KEYS.every((k) => isSectionEmpty(resume, k))) {
    const error = publicError(
      "unreadable_resume",
      "That document does not look like a resume we can work from. Upload a different file, or paste your resume text.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-1", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  // The sectioned resume should restate the source. The checker flags any
  // metric or fact it cannot trace — shown to the visitor, not a gate.
  const facts = await checkFacts({ codeRoot, runDir, text: resumeText(resume), sourcePath: sourceFactsPath });
  diag({ factCheck: { target: "parsed_resume", ran: facts.ran, verdict: facts.verdict, flags: facts.flags, detail: facts.detail } });

  // Show the resume now; recommendations follow when they are ready. The
  // runner starts the job search from this seed in parallel.
  emit("resume.parsed", { resume }, "refine");
  onParsed?.(parseData.searchSeed ?? {});
  emit("action.completed", { stage: "refine", actionId: "refine-1" }, "refine");

  // ── Action 3: recommendations, one section at a time ───────────────────
  emit("action.started", { action: actionRecord(2, labels[2]) }, "refine");

  const suggested = await call({
    system: await resumeRecommendationSystem(codeRoot),
    user: resumeRecommendationUser(untrusted("STRUCTURED RESUME", JSON.stringify(resume, null, 2))),
    schema: RESUME_RECOMMENDATIONS_SCHEMA,
    schemaName: "emit_resume_recommendations",
    maxTokens: 4096,
  });
  // A failed suggestion pass is not a failed resume: the visitor still has
  // their content to review and accept, and the UI says suggestions are missing.
  const recommendationsAvailable = !suggested.error;

  const recommendations = [];
  const seen = new Set();
  for (const raw of suggested.data?.recommendations ?? []) {
    if (recommendations.length >= 12) break;
    const rec = {
      id: `rec-${recommendations.length + 1}`,
      section: String(raw?.section ?? ""),
      kind: ["clarity", "structure", "formatting", "relevance"].includes(raw?.kind) ? raw.kind : "clarity",
      label: String(raw?.label ?? "").trim().slice(0, 60) || "Suggested edit",
      explanation: String(raw?.explanation ?? "").trim(),
      before: String(raw?.before ?? ""),
      after: String(raw?.after ?? "").trim(),
    };
    const key = `${rec.section}\u0000${rec.before}`;
    // Must apply to ITS section as-is, or the button would do nothing.
    if (seen.has(key) || !applyRecommendation(resume, rec)) {
      diag({ droppedRecommendation: { reason: "does_not_apply", section: rec.section } });
      continue;
    }
    // The replacement text must not carry a claim the source does not.
    const recFacts = await checkFacts({ codeRoot, runDir, text: rec.after, sourcePath: sourceFactsPath });
    if (!recFacts.ran || recFacts.flags.length > 0) {
      diag({ droppedRecommendation: { reason: "fact_check", section: rec.section, flags: recFacts.flags } });
      continue;
    }
    seen.add(key);
    recommendations.push(rec);
  }
  diag({ recommendations: { available: recommendationsAvailable, kept: recommendations.length } });
  emit("action.completed", { stage: "refine", actionId: "refine-2" }, "refine");

  // ── Action 4: formatting — validate and build the base CV ─────────────
  emit("action.started", { action: actionRecord(3, labels[3]) }, "refine");

  // The base CV is the resume AS READ. Recommendations reach a CV only once
  // the visitor applies and accepts them (prepare reads that acceptance).
  const payload = toCvPayload(resume);

  // Validate against career-ops's OWN payload contract before rendering, so a
  // section that would silently vanish fails loudly here instead.
  const { validatePayload } = await import(
    path.join(codeRoot, "lib", "cv-payload-schema.mjs")
  );
  const validation = validatePayload(payload, "html");
  diag({ payloadValidation: validation });
  if (validation && validation.valid === false) {
    const error = publicError(
      "invalid_model_output",
      "We could not lay out your resume. You can retry this step.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-3", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  const built = await buildCvDocument({
    codeRoot,
    runDir,
    env,
    payload,
    basename: "base-resume",
  });

  if (!built.ok) {
    diag({ documentError: built });
    const error = publicError(
      "document_render_failed",
      "We could not lay out your resume. You can retry this step.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-3", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  emit("action.completed", { stage: "refine", actionId: "refine-3" }, "refine");

  // Artifacts exist on disk. NOW the result event may be emitted.
  emit(
    "stage.result",
    {
      stage: "refine",
      inputVersion: 1,
      result: {
        kind: "refine",
        // Registered by the parent, which owns the artifact registry.
        originalArtifactId: path.relative(runDir, originalPath),
        refinedResumeArtifactId: path.relative(runDir, built.document),
        resume,
        recommendations,
        recommendationsAvailable,
        // Flags, not a verdict: the checker is a heuristic and the UI says so.
        factCheck: { ran: facts.ran, flags: facts.flags },
        originalPreserved: true,
      },
    },
    "refine",
  );

  return {
    ok: true,
    searchSeed: parseData.searchSeed ?? {},
    sourceFactsPath,
    sourceResumeHash,
    resume,
    recommendations,
  };
}
