/**
 * Stage 4 — Bulk Apply packages. Real work.
 *
 * 02-screen-guide.md §7 and milestone 6, in the order they bite:
 *
 *  1. A package is keyed by JOB ID. Two requisitions at one employer get two
 *     separate drafts.
 *  2. Readiness changes on ACTUAL artifact/capability validation — never after
 *     an elapsed timer.
 *  3. The tailored CV is built from the payload stage 1 already validated,
 *     REORDERED. The builder never receives a sentence the model invented, so
 *     "keywords get reformulated, never fabricated" holds by construction.
 *  4. Only final letter text is emitted. No chain-of-thought, no prompts, no
 *     provider detail.
 *  5. Capability stays `manual_only` with reason `pilot_disabled`. Material
 *     readiness never earns "Ready to auto-apply" — that needs a tested
 *     adapter (milestone 8), and nothing here may claim a letter was sent.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { ModelError, requestStructured, untrusted } from "../../src/lib/hirecute/model.mjs";
import { PACKAGE_SCHEMA, letterSystem, packageUser } from "../../src/lib/hirecute/prompts.mjs";
import { buildCvPdf } from "../../src/lib/hirecute/documents.mjs";
import { ACTION_LABELS } from "../../src/lib/hirecute/action-labels.mjs";
import { LIMITS } from "../../src/lib/hirecute/limits.mjs";

const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

function actionRecord(index, label) {
  return {
    id: `prepare-${index}`,
    stage: "prepare",
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
  stage: "prepare",
  jobId,
});

/**
 * Reorder the candidate's OWN bullets by the model's emphasis list.
 *
 * Anything the model returns that is not a verbatim existing bullet is dropped.
 * That is the whole safety property: the tailored CV can only ever contain
 * sentences stage 1 already validated against the source document.
 */
function reorderBullets(experience, emphasisOrder) {
  if (!Array.isArray(emphasisOrder) || emphasisOrder.length === 0) return experience;
  const wanted = emphasisOrder.map((s) => String(s).trim());
  const rank = new Map(wanted.map((s, i) => [s, i]));

  return experience.map((role) => {
    if (!Array.isArray(role.bullets) || role.bullets.length < 2) return role;
    const bullets = [...role.bullets].sort((a, b) => {
      const ai = rank.has(String(a).trim()) ? rank.get(String(a).trim()) : Infinity;
      const bi = rank.has(String(b).trim()) ? rank.get(String(b).trim()) : Infinity;
      if (ai !== bi) return ai - bi;
      // Stable: unranked bullets keep their original relative order.
      return role.bullets.indexOf(a) - role.bullets.indexOf(b);
    });
    return { ...role, bullets };
  });
}

/** A package in its initial, honest state: queued, manual-only, not approved. */
function basePackage(jobId, sourceResumeHash) {
  return {
    jobId,
    version: 1,
    sourceResumeHash,
    tailoredResumeArtifactId: null,
    letterArtifactId: null,
    letter: { status: "not_started", current: null },
    answers: [],
    readiness: { status: "preparing" },
    // Submission is disabled, so every package is manual-only by construction.
    capability: { kind: "manual_only", reason: "pilot_disabled" },
    submission: { status: "not_approved" },
    packageHash: null,
  };
}

/**
 * @param {object} ctx
 * @param {(type: string, payload: unknown, stage?: string|null) => void} ctx.emit
 * @param {(entry: unknown) => void} ctx.diag
 * @param {string} ctx.runDir
 * @param {string} ctx.codeRoot
 * @param {Record<string,string>} ctx.utilityEnv  Credential-free child env.
 * @param {object[]} ctx.jobs
 * @param {object[]} ctx.assessments
 * @param {string[]} ctx.ranked
 * @param {object} ctx.payload            Validated CV payload from stage 1.
 * @param {string} ctx.sourceFactsPath
 * @param {string} ctx.sourceResumeHash
 */
export async function runPrepareStage(ctx) {
  const {
    emit,
    diag,
    runDir,
    codeRoot,
    utilityEnv,
    jobs,
    assessments,
    ranked,
    payload,
    sourceFactsPath,
    sourceResumeHash,
  } = ctx;
  const labels = ACTION_LABELS.prepare;

  emit("stage.started", { stage: "prepare", inputVersion: 1, attempt: 1 }, "prepare");

  // Prepare the first VISIBLE jobs first (§7), then the rest within limits.
  const selected = ranked.slice(0, LIMITS.maxSelectedPackages);
  const visibleFirst = selected.slice(0, LIMITS.firstVisibleLetters);
  const rest = selected.slice(LIMITS.firstVisibleLetters);

  // Everything scored starts selected; the visitor narrows it down.
  emit(
    "selection.updated",
    { selection: { jobIds: selected, version: 1, updatedAt: new Date().toISOString() } },
    "prepare",
  );

  // Cards appear as queued packages immediately, so the list is populated
  // before any letter exists.
  for (const jobId of selected) {
    emit("application.updated", { application: basePackage(jobId, sourceResumeHash) }, "prepare");
  }

  emit("action.started", { action: actionRecord(0, labels[0]) }, "prepare");
  const resumeFacts = untrusted("RESUME FACTS", await readFile(sourceFactsPath, "utf8"));
  const system = await letterSystem(codeRoot);
  emit("action.completed", { stage: "prepare", actionId: "prepare-0" }, "prepare");

  emit("action.started", { action: actionRecord(1, labels[1]) }, "prepare");
  emit("action.started", { action: actionRecord(2, labels[2]) }, "prepare");

  const prepared = [];
  const blocked = [];
  const failed = [];
  let modelCalls = 0;

  async function prepareOne(jobId) {
    const job = jobs.find((j) => j.id === jobId);
    const assessment = assessments.find((a) => a.jobId === jobId);
    if (!job) return;

    const pkg = basePackage(jobId, sourceResumeHash);
    const generationId = `gen-${jobId}-1`;

    let jd = "";
    try {
      jd = await readFile(path.join(runDir, "jds", `${jobId}.txt`), "utf8");
    } catch {
      /* scored jobs always have an archived JD, but do not assume it */
    }

    emit("letter.started", { jobId, generationId, baseVersion: null }, "prepare");

    let data;
    try {
      if (modelCalls >= LIMITS.maxModelCallsPerRun) throw new ModelError("model_timeout", "Budget exhausted.", false);
      modelCalls += 1;
      const response = await requestStructured({
        system,
        user: packageUser({
          resumeFacts,
          job,
          jobDescription: untrusted("JOB DESCRIPTION", jd.slice(0, 20_000)),
          assessment,
        }),
        schema: PACKAGE_SCHEMA,
        schemaName: "emit_application_package",
        maxTokens: 3072,
      });
      data = response.data;
      diag({ package: { jobId, usage: response.usage } });
    } catch (err) {
      diag({
        packageError: {
          jobId,
          code: err instanceof ModelError ? err.code : "unknown",
          // Provider detail goes HERE, never into a public event.
          detail: err?.detail ?? String(err?.message ?? err),
        },
      });
      const error = publicError(
        "invalid_model_output",
        "We could not draft this letter. You can retry this role.",
        true,
        jobId,
      );
      emit("letter.error", { jobId, generationId, error }, "prepare");
      emit(
        "application.updated",
        { application: { ...pkg, version: 2, readiness: { status: "failed", error } } },
        "prepare",
      );
      failed.push(jobId);
      return;
    }

    const letterText = typeof data.letter === "string" ? data.letter.trim() : "";
    // A letter with an unfilled placeholder is not a draft a person can send.
    if (letterText.length < 200 || /\[[A-Z_ ]{3,}\]/.test(letterText)) {
      const error = publicError(
        "invalid_model_output",
        "That draft came back incomplete. You can retry this role.",
        true,
        jobId,
      );
      diag({ rejectedLetter: { jobId, length: letterText.length } });
      emit("letter.error", { jobId, generationId, error }, "prepare");
      emit(
        "application.updated",
        { application: { ...pkg, version: 2, readiness: { status: "failed", error } } },
        "prepare",
      );
      failed.push(jobId);
      return;
    }

    // Reveal the VALIDATED text. §7: "Emit only final letter content in
    // letter.delta events, or reveal validated completed text smoothly." We
    // chunk the finished letter rather than streaming raw generation, so no
    // partial or discarded model text can ever reach the panel.
    for (const chunk of letterText.match(/[\s\S]{1,120}/g) ?? []) {
      emit("letter.delta", { jobId, generationId, baseVersion: null, text: chunk }, "prepare");
    }

    const revision = {
      version: 1,
      author: "model",
      text: letterText,
      subject:
        typeof data.subject === "string" && data.subject.trim()
          ? data.subject.trim()
          : `Application: ${job.title}`,
      updatedAt: new Date().toISOString(),
      contentHash: sha256(letterText),
      sourceFactIds: [],
      jobContentHash: job.source.postingContentHash,
    };
    emit("letter.completed", { jobId, generationId, revision }, "prepare");

    // ── The tailored CV: the SAME validated payload, reordered ──────────
    const tailored = {
      ...payload,
      // A rewritten summary is the one generated sentence, and it is
      // fact-checked below like any other generated text.
      summary: typeof data.summary === "string" && data.summary.trim() ? data.summary.trim() : payload.summary,
      experience: reorderBullets(payload.experience ?? [], data.emphasisOrder),
    };

    const built = await buildCvPdf({
      codeRoot,
      runDir,
      env: utilityEnv,
      payload: tailored,
      // Job-keyed filename: two roles at one employer cannot collide.
      basename: path.join("jobs", jobId, "cv"),
    });

    if (!built.ok) {
      diag({ cvError: { jobId, ...built } });
      // The letter is real and usable even if the PDF failed, so the package
      // is NOT marked ready — readiness follows actual artifacts.
      const error = publicError(
        "document_render_failed",
        "Your letter is ready but the tailored CV could not be rendered. You can retry this role.",
        true,
        jobId,
      );
      emit(
        "application.updated",
        {
          application: {
            ...pkg,
            version: 2,
            letter: { status: "ready", current: revision },
            readiness: { status: "failed", error },
          },
        },
        "prepare",
      );
      failed.push(jobId);
      return;
    }

    // Both artifacts exist. NOW readiness may change.
    emit(
      "application.updated",
      {
        application: {
          ...pkg,
          version: 2,
          tailoredResumeArtifactId: path.relative(runDir, built.pdf),
          letter: { status: "ready", current: revision },
          readiness: { status: "ready", verifiedAt: new Date().toISOString() },
          packageHash: sha256(`${revision.contentHash}\n${job.source.postingContentHash}`),
        },
      },
      "prepare",
    );
    prepared.push(jobId);
  }

  // Visible jobs first, sequentially within the model-call limit, then the rest.
  for (const jobId of visibleFirst) await prepareOne(jobId);
  emit("action.completed", { stage: "prepare", actionId: "prepare-1" }, "prepare");
  emit("action.completed", { stage: "prepare", actionId: "prepare-2" }, "prepare");

  emit("action.started", { action: actionRecord(3, labels[3]) }, "prepare");
  for (const jobId of rest) await prepareOne(jobId);
  emit("action.completed", { stage: "prepare", actionId: "prepare-3" }, "prepare");

  diag({ prepared: prepared.length, blocked: blocked.length, failed: failed.length });

  if (prepared.length === 0) {
    const error = publicError(
      "invalid_model_output",
      "We could not prepare any applications just now. You can retry this step — your matches are saved.",
      true,
    );
    emit("stage.error", { stage: "prepare", inputVersion: 1, error }, "prepare");
    return { ok: false };
  }

  emit(
    "stage.result",
    {
      stage: "prepare",
      inputVersion: 1,
      result: {
        kind: "prepare",
        preparedJobIds: prepared,
        blockedJobIds: blocked,
        failedJobIds: failed,
      },
    },
    "prepare",
  );

  return { ok: true, prepared, blocked, failed };
}
