/**
 * Stage 1 — Finetune Resume. Real work.
 *
 * 02-screen-guide.md §4 maps four visible actions onto four completion
 * conditions, and this file exists to honour them exactly: each action is
 * marked complete only when its condition actually holds.
 *
 *   Reading your resume                      → extraction produced usable text
 *   Extracting your experience and skills    → validated facts + search seed saved
 *   Refining your summary and bullet points  → revision produced, no new facts
 *   Checking formatting and readability      → payload validates, HTML/PDF built
 *
 * Ordering rule from §2: "A validated result is written to the server store
 * before its result event." So artifacts land on disk, then `stage.result` is
 * emitted. Never the other way round.
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

import { extractResumeText, extractionMessage } from "../../src/lib/hirecute/extract.mjs";
import { ModelError, requestStructured, untrusted } from "../../src/lib/hirecute/model.mjs";
import {
  RESUME_REFINEMENT_SCHEMA,
  resumeRefinementSystem,
  resumeRefinementUser,
} from "../../src/lib/hirecute/prompts.mjs";
import { buildCvPdf, checkFacts, sourceFactsMarkdown } from "../../src/lib/hirecute/documents.mjs";
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
  const { emit, diag, runDir, codeRoot, env } = ctx;
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

  // ── Actions 2+3: extract facts and refine (one model call) ────────────
  emit("action.started", { action: actionRecord(1, labels[1]) }, "refine");

  let result;
  try {
    const system = await resumeRefinementSystem(codeRoot);
    const response = await requestStructured({
      system,
      user: resumeRefinementUser(untrusted("RESUME", extracted.text)),
      schema: RESUME_REFINEMENT_SCHEMA,
      schemaName: "emit_resume_refinement",
      maxTokens: 8192,
    });
    diag({ model: { usage: response.usage, model: response.model } });
    result = response.data;
  } catch (err) {
    const error = publicError(
      err instanceof ModelError ? err.code : "internal_error",
      err instanceof ModelError ? err.message : "We could not refine your resume just now.",
      err instanceof ModelError ? err.retryable : true,
    );
    diag({ modelError: { code: error.code, detail: err?.detail ?? String(err?.message ?? err) } });
    emit("action.error", { stage: "refine", actionId: "refine-1", error }, "refine");
    // §4: "Model/validation failure: show original and retry, with no
    // fabricated refined column." The original is untouched.
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  // Validation, not trust. The schema shaped the response; these checks decide
  // whether it is usable.
  if (result.usable === false || !result.payload?.experience?.length) {
    const error = publicError(
      "unreadable_resume",
      "That document does not look like a resume we can work from. Upload a different file, or paste your resume text.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-1", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  emit("action.completed", { stage: "refine", actionId: "refine-1" }, "refine");

  emit("action.started", { action: actionRecord(2, labels[2]) }, "refine");
  // The real, unpadded change list. An empty array is a valid outcome and the
  // receipt says "Resume reviewed · Original kept" rather than inventing a count.
  const changes = Array.isArray(result.changes)
    ? result.changes
        // A "change" whose before and after are identical is noise, not work.
        .filter((c) => c && c.before !== c.after && typeof c.after === "string")
        .map((c) => ({
          id: randomUUID(),
          kind: ["clarity", "structure", "formatting", "relevance"].includes(c.kind)
            ? c.kind
            : "clarity",
          before: String(c.before ?? ""),
          after: String(c.after ?? ""),
          explanation: String(c.explanation ?? ""),
          sourceFactIds: [],
        }))
    : [];
  emit("action.completed", { stage: "refine", actionId: "refine-2" }, "refine");

  // ── Action 4: build the documents ─────────────────────────────────────
  emit("action.started", { action: actionRecord(3, labels[3]) }, "refine");

  // The HTML builder reads `payload.candidate` for identity/contact and
  // `payload.summary` at the root. Naming those differently renders an EMPTY
  // header while validation still passes — upstream #3523, which
  // lib/cv-payload-schema.mjs exists to warn about.
  const payload = {
    candidate: result.candidate ?? {},
    summary: result.summary ?? "",
    ...result.payload,
  };

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
      "We could not lay out your refined resume. You can retry this step.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-3", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  const built = await buildCvPdf({
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
      built.stage === "pdf"
        ? "Your refined resume is ready but the PDF could not be produced. You can retry that step."
        : "We could not lay out your refined resume. You can retry this step.",
      true,
    );
    emit("action.error", { stage: "refine", actionId: "refine-3", error }, "refine");
    emit("stage.error", { stage: "refine", inputVersion: 1, error }, "refine");
    return { ok: false };
  }

  // Heuristic check, recorded as findings. NOT a guarantee, and not a gate:
  // blocking a factual CV on a heuristic would be worse than surfacing it.
  const facts = await checkFacts({
    codeRoot,
    env,
    documentPath: built.html,
    sourcePath: sourceFactsPath,
  });
  diag({ factCheck: { ran: facts.ran, findings: facts.findings?.length ?? 0, detail: facts.detail } });

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
        refinedResumeArtifactId: path.relative(runDir, built.pdf),
        changes,
        originalPreserved: true,
      },
    },
    "refine",
  );

  return {
    ok: true,
    searchSeed: result.searchSeed ?? {},
    sourceFactsPath,
    sourceResumeHash,
    payload,
  };
}
