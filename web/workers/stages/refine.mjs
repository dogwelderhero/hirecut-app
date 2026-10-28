/**
 * Stage 1 — Finetune Resume. Real work.
 *
 * Seven visible actions, each marked complete only when its work holds:
 *
 *   Opening your file                       → the stored original was found
 *   Reading the text in your resume         → extraction produced usable text,
 *                                             written verbatim as the fact source
 *   Mapping every section and role          → model read it into sections, validated
 *   Checking every detail against your file → fact check ran; resume published
 *   Noting which sections are missing       → empty sections recorded
 *   Checking formatting and readability     → payload validates against the CV contract
 *   Building a clean copy of your resume    → base CV document rendered
 *
 * Ordering rule from §2: "A validated result is written to the server store
 * before its result event." So artifacts land on disk, then `stage.result` is
 * emitted. Never the other way round.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { extractResumeText, extractionMessage } from "../../src/lib/hirecute/extract.mjs";
import { ModelError } from "../../src/lib/hirecute/model.mjs";
import { parseResume } from "../../src/lib/hirecute/resume-parse.mjs";
import { buildCvDocument, checkFacts, sourceFactsMarkdown } from "../../src/lib/hirecute/documents.mjs";
import { SECTION_KEYS, isSectionEmpty, resumeText, toCvPayload } from "../../src/lib/hirecute/resume.mjs";
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

  // Each action starts when its work starts and completes only when that work
  // has actually finished — never on a timer.
  const start = (i) => emit("action.started", { action: actionRecord(i, labels[i]) }, "refine");
  const complete = (i) => emit("action.completed", { stage: "refine", actionId: `refine-${i}` }, "refine");

  // ── Action 1: open the stored original ─────────────────────────────────
  start(0);

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

  complete(0);

  // ── Action 2: pull the text out of the file ────────────────────────────
  start(1);
  const bytes = await readFile(originalPath);
  const extracted = await extractResumeText(bytes);
  if (!extracted.ok) {
    // §4: "Extraction failure: keep the received-file receipt, explain what
    // could not be read, allow replacement." The original stays on disk.
    diag({ extraction: { reason: extracted.reason, detail: extracted.detail } });
    const error = publicError("unreadable_resume", extractionMessage(extracted.reason), true);
    emit("action.error", { stage: "refine", actionId: "refine-1", error }, "refine");
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
  complete(1);

  // ── Action 3: read the resume into sections (no rewriting) ─────────────
  start(2);

  // The call and the validation of its reply live in resume-parse.mjs, the
  // same code the parse evals (web/evals/parse) measure.
  const parsed = await parseResume(extracted.text);
  if (!parsed.ok && parsed.reason === "model") {
    const err = parsed.error;
    diag({ modelError: { call: "emit_resume_sections", detail: err?.detail ?? String(err?.message ?? err) } });
    const error = publicError(
      err instanceof ModelError ? err.code : "internal_error",
      err instanceof ModelError ? err.message : "We could not read your resume just now.",
      err instanceof ModelError ? err.retryable : true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-2", error }, "refine");
    // §4: "Model/validation failure: show original and retry." The original is untouched.
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }
  diag({ model: { call: "emit_resume_sections", usage: parsed.usage, model: parsed.model } });
  const { resume, parseData } = parsed;
  diag({ parse: { keys: Object.keys(parseData), usable: parseData.usable ?? null } });
  if (!parsed.ok) {
    const error = publicError(
      "unreadable_resume",
      "That document does not look like a resume we can work from. Upload a different file, or paste your resume text.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-2", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }
  complete(2);

  // ── Action 4: check the sections against the verbatim file ─────────────
  // The sectioned resume should restate the source. The checker flags any
  // metric or fact it cannot trace — shown to the visitor, not a gate.
  start(3);
  const facts = await checkFacts({ codeRoot, runDir, text: resumeText(resume), sourcePath: sourceFactsPath });
  diag({ factCheck: { target: "parsed_resume", ran: facts.ran, verdict: facts.verdict, flags: facts.flags, detail: facts.detail } });
  // The resume can be shown now: it is read and checked.
  emit("resume.parsed", { resume }, "refine");
  onParsed?.(parseData.searchSeed ?? {});
  complete(3);

  // ── Action 5: note which sections the resume does not have ────────────
  start(4);
  diag({ missingSections: SECTION_KEYS.filter((k) => isSectionEmpty(resume, k)) });
  complete(4);

  // Suggestions are no longer written here. They come in step 3, built from
  // the gaps the job matching finds, so every change answers a real posting.
  const recommendations = [];
  const recommendationsAvailable = true;

  // ── Action 6: formatting — validate against the CV payload contract ────
  start(5);

  // The base CV is the resume AS READ. Recommendations reach a CV only once
  // the visitor applies and accepts them (prepare reads that acceptance).
  const payload = toCvPayload(resume);

  // Validate against career-ops's OWN payload contract before rendering, so a
  // section that would silently vanish fails loudly here instead.
  const { validatePayload } = await import(
    pathToFileURL(path.join(codeRoot, "lib", "cv-payload-schema.mjs")).href
  );
  const validation = validatePayload(payload, "html");
  diag({ payloadValidation: validation });
  if (validation && validation.valid === false) {
    const error = publicError(
      "invalid_model_output",
      "We could not lay out your resume. You can retry this step.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-5", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }
  complete(5);

  // ── Action 7: build a clean copy of the resume as read ────────────────
  start(6);
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
    emit("action.error", { stage: "refine", actionId: "refine-6", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  complete(6);

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
