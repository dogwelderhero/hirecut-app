/**
 * Stage 2 — Explore Jobs. Real work, zero tokens.
 *
 * 02-screen-guide.md §5 maps four actions onto real operations:
 *
 *   Building a search from your experience   → search seed from stage 1
 *   Checking company career pages            → bounded provider fetches
 *   Removing duplicates and expired listings → canonical-URL dedup
 *   Saving relevant openings                 → filtered set persisted
 *
 * Two rules this file exists to honour:
 *  - "Provider progress must reflect real requests/completions. Do not show
 *    Workday as actively scanned if the MVP only uses curated
 *    Greenhouse/Lever/Ashby boards."
 *  - Partial coverage is a RESULT, not an error. One board failing must not
 *    erase the others' postings.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { enabledBoards, scopeDescription } from "../../src/lib/hirecute/boards.mjs";
import { fetchBoards } from "../../src/lib/hirecute/upstream.mjs";
import { filterRelevant, normalizeHarvest } from "../../src/lib/hirecute/jobs.mjs";
import { ACTION_LABELS } from "../../src/lib/hirecute/action-labels.mjs";
import { LIMITS } from "../../src/lib/hirecute/limits.mjs";

const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

function actionRecord(index, label) {
  return {
    id: `explore-${index}`,
    stage: "explore",
    label,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

const publicError = (code, message, retryable) => ({
  code,
  message,
  retryable,
  stage: "explore",
  jobId: null,
});

/**
 * @param {object} ctx
 * @param {(type: string, payload: unknown, stage?: string|null) => void} ctx.emit
 * @param {(entry: unknown) => void} ctx.diag
 * @param {string} ctx.runDir
 * @param {string} ctx.codeRoot
 * @param {object} ctx.searchSeed   From the REAL stage-1 refinement.
 * @param {object} ctx.preferences  Confirmed candidate preferences, if any.
 */
export async function runExploreStage(ctx) {
  const { emit, diag, runDir, codeRoot, searchSeed = {}, preferences = {} } = ctx;
  const labels = ACTION_LABELS.explore;

  emit("stage.started", { stage: "explore", inputVersion: 1, attempt: 1 }, "explore");

  // ── Action 1: build the search ────────────────────────────────────────
  emit("action.started", { action: actionRecord(0, labels[0]) }, "explore");

  // Explicitly confirmed preferences outrank the resume-derived seed. An
  // unconfirmed preference stays BROAD — §5: "A CV's location is not proof that
  // the candidate is authorized to work there."
  const targetRoles =
    preferences.targetRoles?.length > 0
      ? preferences.targetRoles
      : [searchSeed.currentTitle, ...(searchSeed.targetRoles ?? [])].filter(Boolean);
  // The resume's stated location is a SOFT hint about where to look — not a
  // claim about work authorization, and not a hard filter. Using it stops the
  // incoherence of surfacing US-only roles for a London candidate and then
  // scoring them down for being in the US (location is score-neutral in the
  // rubric, so the filter is where geography belongs).
  const locations =
    preferences.locations?.length > 0
      ? preferences.locations
      : searchSeed.location
        ? [String(searchSeed.location).split(",")[0].trim()]
        : [];

  diag({ search: { targetRoles, locations, seededFrom: preferences.targetRoles?.length ? "candidate" : "resume" } });
  emit("action.completed", { stage: "explore", actionId: "explore-0" }, "explore");

  // ── Action 2: check career pages ──────────────────────────────────────
  emit("action.started", { action: actionRecord(1, labels[1]) }, "explore");

  const boards = enabledBoards();
  let harvest;
  try {
    harvest = await fetchBoards({
      codeRoot,
      boards,
      concurrency: 4,
      deadlineMs: LIMITS.discoveryTargetMs,
      // Progress reflects real completions, one entry per board that actually
      // finished — never a synthetic ticker.
      onBoard: (event) => diag({ board: event }),
    });
  } catch (err) {
    const error = publicError(
      "scan_failed",
      "We could not reach the job boards just now. You can retry this step.",
      true,
    );
    diag({ exploreError: String(err?.message ?? err) });
    emit("action.error", { stage: "explore", actionId: "explore-1", error }, "explore");
    emit("stage.error", { stage: "explore", inputVersion: 1, error }, "explore");
    return { ok: false };
  }

  diag({
    harvest: {
      postings: harvest.raw.length,
      succeeded: harvest.coverage.boardsSucceeded,
      failed: harvest.coverage.boardsFailed,
    },
  });
  emit("action.completed", { stage: "explore", actionId: "explore-1" }, "explore");

  // ── Action 3: dedup ───────────────────────────────────────────────────
  emit("action.started", { action: actionRecord(2, labels[2]) }, "explore");

  const { jobs: allJobs, descriptions, duplicates } = await normalizeHarvest({
    codeRoot,
    raw: harvest.raw,
    sha256,
  });
  diag({ dedup: { unique: allJobs.length, duplicatesDropped: duplicates } });
  emit("action.completed", { stage: "explore", actionId: "explore-2" }, "explore");

  // ── Action 4: save relevant openings ──────────────────────────────────
  emit("action.started", { action: actionRecord(3, labels[3]) }, "explore");

  const relevant = filterRelevant(allJobs, {
    targetRoles,
    locations,
    limit: LIMITS.maxDiscoveredJobs,
  });

  // JD text is archived at ingest, not fetched on demand: a posting dies and
  // the archived text is the only durable record.
  const jdDir = path.join(runDir, "jds");
  await mkdir(jdDir, { recursive: true });
  for (const job of relevant) {
    const text = descriptions.get(job.id);
    if (!text) continue;
    await writeFile(path.join(jdDir, `${job.id}.txt`), text, "utf8");
    job.descriptionStatus = "full";
  }

  const coverage = {
    ...harvest.coverage,
    jobsRetained: relevant.length,
    scopeDescription: scopeDescription(boards),
  };

  // Emit each retained job so cards can appear as real results.
  for (const job of relevant) emit("job.discovered", { job }, "explore");

  emit("action.completed", { stage: "explore", actionId: "explore-3" }, "explore");

  if (relevant.length === 0) {
    // §5: an empty result explains scope and offers preference edits. It does
    // NOT advance to a pretend shortlist.
    const error = publicError(
      "no_matching_jobs",
      `We checked ${coverage.scopeDescription} and found no open roles matching your experience. Widen your roles or locations and try again.`,
      true,
    );
    emit("stage.error", { stage: "explore", inputVersion: 1, error }, "explore");
    return { ok: false, coverage };
  }

  emit(
    "stage.result",
    {
      stage: "explore",
      inputVersion: 1,
      result: { kind: "explore", jobIds: relevant.map((j) => j.id), coverage },
    },
    "explore",
  );

  return { ok: true, jobs: relevant, coverage, jdDir };
}
