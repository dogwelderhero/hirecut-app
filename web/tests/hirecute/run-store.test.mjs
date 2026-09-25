import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { initialRunState, applyEvent, applyEvents, lifecycleOnStreamEnd, completedStages } =
  await import("../../src/lib/hirecute/run-store.ts");
const { displayText, editLetter, letterSaved } = await import(
  "../../src/lib/hirecute/letters.ts"
);
const { FIXTURE_JOBS } = await import("../../src/lib/hirecute/fixtures.ts");

// 02-screen-guide.md §2 event protocol.

let seq = 0;
function ev(type, payload, over = {}) {
  seq += 1;
  return {
    version: 1,
    runId: "run-1",
    seq,
    time: "2026-09-25T09:00:00.000Z",
    input: {
      journeyVersion: 1,
      sourceResumeHash: "sha256:r",
      preferencesVersion: 1,
      stageInputVersion: 1,
      stageAttempt: 1,
    },
    type,
    payload,
    ...over,
  };
}

const action = (id, stage) => ({
  id,
  stage,
  label: "Reading your resume",
  status: "in_progress",
  startedAt: "2026-09-25T09:00:00.000Z",
  completedAt: null,
  error: null,
});

test("a replayed event (seq <= lastSequence) is dropped, so no transcript row duplicates", () => {
  seq = 0;
  const started = ev("action.started", { action: action("a1", "refine") });
  let s = applyEvent(initialRunState(), started);
  assert.equal(s.actions.length, 1);

  // Exactly the same envelope arrives again after a reconnect.
  s = applyEvent(s, started);
  assert.equal(s.actions.length, 1, "duplicate delivery must not duplicate the action");
  assert.equal(s.lastSequence, 1);
});

test("actions append in start order; a failure keeps the completed rows above it", () => {
  seq = 0;
  const s = applyEvents(initialRunState(), [
    ev("action.started", { action: action("a1", "refine") }),
    ev("action.completed", { stage: "refine", actionId: "a1" }),
    ev("action.started", { action: action("a2", "refine") }),
    ev("action.error", {
      stage: "refine",
      actionId: "a2",
      error: { code: "model_timeout", message: "timed out", retryable: true, stage: "refine", jobId: null },
    }),
  ]);
  assert.deepEqual(
    s.actions.map((a) => [a.id, a.status]),
    [
      ["a1", "completed"],
      ["a2", "failed"],
    ],
  );
});

test("stage.result is the only terminal success; a mismatched result kind is refused", () => {
  seq = 0;
  let s = applyEvents(initialRunState(), [
    ev("stage.started", { stage: "explore", inputVersion: 1, attempt: 1 }),
  ]);
  assert.equal(s.stages.explore.status, "running");

  // A worker claiming explore completed but handing back a refine result is not
  // trusted to have completed the stage.
  s = applyEvent(
    s,
    ev("stage.result", {
      stage: "explore",
      inputVersion: 1,
      result: { kind: "refine", originalArtifactId: "a", refinedResumeArtifactId: "b", changes: [], originalPreserved: true },
    }),
  );
  assert.equal(s.stages.explore.status, "running", "mismatched result.kind does not complete");

  s = applyEvent(
    s,
    ev("stage.result", {
      stage: "explore",
      inputVersion: 1,
      result: { kind: "explore", jobIds: ["job-1"], coverage: { status: "partial" } },
    }),
  );
  assert.equal(s.stages.explore.status, "completed");
  assert.deepEqual(completedStages(s), ["explore"]);
});

test("stream EOF without a terminal record is interrupted, not success", () => {
  seq = 0;
  const running = applyEvents(initialRunState(), [ev("run.started", { stage: "refine" })]);
  assert.equal(lifecycleOnStreamEnd(running), "interrupted");

  const done = applyEvent(running, ev("run.done", { outcome: "preparation_complete", resultStage: "prepare" }));
  assert.equal(lifecycleOnStreamEnd(done), "done", "an explicit terminal record does complete");
});

test("keepalive is connection health only and completes nothing", () => {
  seq = 0;
  const before = applyEvents(initialRunState(), [ev("run.started", { stage: "refine" })]);
  const after = applyEvent(before, ev("keepalive", {}));
  assert.equal(after.lifecycle, "running");
  assert.deepEqual(completedStages(after), []);
});

test("discovered jobs keep their arrival order and re-discovery does not duplicate", () => {
  seq = 0;
  let s = applyEvents(
    initialRunState(),
    FIXTURE_JOBS.slice(0, 3).map((job) => ev("job.discovered", { job })),
  );
  assert.deepEqual(s.jobOrder, ["job-1", "job-2", "job-3"]);

  s = applyEvent(s, ev("job.discovered", { job: FIXTURE_JOBS[0] }));
  assert.deepEqual(s.jobOrder, ["job-1", "job-2", "job-3"], "same job twice stays one card");
});

test("two requisitions at one employer remain distinct jobs", () => {
  seq = 0;
  const s = applyEvents(
    initialRunState(),
    FIXTURE_JOBS.slice(0, 2).map((job) => ev("job.discovered", { job })),
  );
  const monzo = Object.values(s.jobs).filter((j) => j.company === "Monzo");
  assert.equal(monzo.length, 2);
  assert.notEqual(monzo[0].title, monzo[1].title);
});

test("a letter delta for job A never lands in job B", () => {
  seq = 0;
  let s = applyEvents(initialRunState(), [
    ev("letter.started", { jobId: "job-1", generationId: "g1", baseVersion: null }),
    ev("letter.started", { jobId: "job-3", generationId: "g2", baseVersion: null }),
    ev("letter.delta", { jobId: "job-1", generationId: "g1", baseVersion: null, text: "Dear Monzo" }),
    ev("letter.delta", { jobId: "job-3", generationId: "g2", baseVersion: null, text: "Dear Wise" }),
  ]);
  assert.equal(s.letters["job-1"].receivedText, "Dear Monzo");
  assert.equal(s.letters["job-3"].receivedText, "Dear Wise");

  // A late chunk from a superseded generation is dropped rather than appended.
  s = applyEvent(
    s,
    ev("letter.delta", { jobId: "job-1", generationId: "stale", baseVersion: null, text: " STALE" }),
  );
  assert.equal(s.letters["job-1"].receivedText, "Dear Monzo");
});

test("a candidate edit wins over a completing model generation", () => {
  seq = 0;
  let s = applyEvents(initialRunState(), [
    ev("letter.started", { jobId: "job-1", generationId: "g1", baseVersion: null }),
    ev("letter.delta", { jobId: "job-1", generationId: "g1", baseVersion: null, text: "model text" }),
  ]);
  s = { ...s, letters: editLetter(s.letters, "job-1", "my own text") };

  // The generation now finishes with different text.
  s = applyEvent(
    s,
    ev("letter.completed", {
      jobId: "job-1",
      generationId: "g1",
      revision: {
        version: 2,
        author: "model",
        text: "model text, finished",
        subject: "s",
        updatedAt: "2026-09-25T09:00:00.000Z",
        contentHash: "h",
        sourceFactIds: [],
        jobContentHash: "j",
      },
    }),
  );
  assert.equal(displayText(s.letters["job-1"]), "my own text", "candidate version wins");
  assert.equal(s.letters["job-1"].dirty, true);
  assert.equal(s.letters["job-1"].serverVersion, 2, "server version still advances for the next save");

  // Saving commits the candidate's text and clears dirty.
  const saved = letterSaved(s.letters, "job-1", {
    version: 3,
    author: "candidate",
    text: "my own text",
    subject: "s",
    updatedAt: "2026-09-25T09:00:00.000Z",
    contentHash: "h2",
    sourceFactIds: [],
    jobContentHash: "j",
  });
  assert.equal(saved["job-1"].dirty, false);
  assert.equal(displayText(saved["job-1"]), "my own text");
});

test("a stale application or selection version cannot clobber a newer one", () => {
  seq = 0;
  const pkg = (version) => ({
    jobId: "job-1",
    version,
    sourceResumeHash: "h",
    tailoredResumeArtifactId: null,
    letterArtifactId: null,
    letter: { status: "not_started", current: null },
    answers: [],
    readiness: { status: "preparing" },
    capability: { kind: "manual_only", reason: "pilot_disabled" },
    submission: { status: "not_approved" },
    packageHash: null,
  });
  let s = applyEvents(initialRunState(), [
    ev("application.updated", { application: pkg(5) }),
    ev("application.updated", { application: pkg(2) }),
  ]);
  assert.equal(s.applications["job-1"].version, 5, "older package write is ignored");

  s = applyEvents(s, [
    ev("selection.updated", { selection: { jobIds: ["job-1", "job-3"], version: 4, updatedAt: "t" } }),
    ev("selection.updated", { selection: { jobIds: [], version: 1, updatedAt: "t" } }),
  ]);
  assert.deepEqual(s.selection.jobIds, ["job-1", "job-3"], "older selection write is ignored");
});

test("credits are authoritative from the server, never inferred from a CTA click", () => {
  seq = 0;
  let s = applyEvent(
    initialRunState(),
    ev("billing.updated", {
      billing: {
        status: "requires_card",
        mode: "test",
        promotionalCredit: null,
        entitlement: null,
        amountChargedMinor: 0,
        error: null,
      },
    }),
  );
  assert.equal(s.billing.status, "requires_card");

  s = applyEvent(
    s,
    ev("credits.granted", {
      grant: { id: "g", amountMinor: 3000, currency: "gbp", grantedAt: "t", setupIntentId: "si_1" },
      entitlement: { includedPackages: 20, usedPackages: 0 },
    }),
  );
  assert.equal(s.billing.status, "activated");
  assert.equal(s.billing.amountChargedMinor, 0, "this MVP never charges");
});
