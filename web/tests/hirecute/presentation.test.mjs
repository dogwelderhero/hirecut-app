import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const {
  presentationReducer,
  initialPresentationState,
  visibleStage,
  isShowingResult,
  stagePacks,
  awaitingAcceptance,
} = await import("../../src/lib/hirecute/presentation.ts");

// 02-screen-guide.md §2 "Work events versus presentation timing".
const DWELL = 2_000;
const PACK = 780;

const reduce = (state, ...actions) => actions.reduce(presentationReducer, state);

test("refine and match pack; explore and prepare never do", () => {
  for (const stage of ["refine", "match"]) assert.equal(stagePacks(stage), true);
  assert.equal(stagePacks("explore"), false, "explore has no screen of its own");
  assert.equal(stagePacks("prepare"), false, "Bulk Apply must not pack away or advance");
});

test("a stage result dwells for 2000ms of foreground time, then packs for 780ms", () => {
  let s = reduce(initialPresentationState(), { type: "stage_result", stage: "match" });
  assert.equal(s.phase.kind, "dwelling");

  s = reduce(s, { type: "tick", deltaMs: DWELL - 1 });
  assert.equal(s.phase.kind, "dwelling", "still dwelling one millisecond short");

  s = reduce(s, { type: "tick", deltaMs: 1 });
  assert.equal(s.phase.kind, "packing");

  s = reduce(s, { type: "tick", deltaMs: PACK - 1 });
  assert.equal(s.phase.kind, "packing");

  s = reduce(s, { type: "tick", deltaMs: 1 });
  assert.equal(s.phase.kind, "idle", "presentation is free for the next stage");
  assert.deepEqual(s.presented, ["match"]);
});

test("a hidden tab pauses the dwell; backend work is unaffected", () => {
  let s = reduce(
    initialPresentationState(),
    { type: "stage_result", stage: "match" },
    { type: "visibility", foreground: false },
  );
  // Ten times the dwell elapses while hidden.
  s = reduce(s, { type: "tick", deltaMs: DWELL * 10 });
  assert.equal(s.phase.kind, "dwelling");
  assert.equal(s.phase.elapsedMs, 0, "hidden time does not accrue");

  s = reduce(s, { type: "visibility", foreground: true }, { type: "tick", deltaMs: DWELL });
  assert.equal(s.phase.kind, "packing", "the visitor still gets a full readable dwell");
});

test("reduced motion keeps the 2s dwell and skips the spatial travel", () => {
  let s = reduce(
    initialPresentationState({ reducedMotion: true }),
    { type: "stage_result", stage: "match" },
    { type: "tick", deltaMs: DWELL - 1 },
  );
  assert.equal(s.phase.kind, "dwelling", "the readable dwell is retained");
  s = reduce(s, { type: "tick", deltaMs: 1 });
  assert.equal(s.phase.kind, "idle", "no packing phase under reduced motion");
  assert.deepEqual(s.presented, ["match"]);
});

test("a fast later stage waits in the queue rather than overwriting the current result", () => {
  // The worker finishes explore and match while refine is still on screen.
  let s = reduce(
    initialPresentationState(),
    { type: "stage_result", stage: "refine" },
    { type: "stage_result", stage: "explore" },
    { type: "stage_result", stage: "match" },
  );
  assert.equal(s.phase.stage, "refine");
  // Explore has no screen: presented on arrival, never queued.
  assert.deepEqual(s.queue, ["match"]);
  assert.deepEqual(s.presented, ["explore"]);

  const advance = (state) =>
    reduce(state, { type: "tick", deltaMs: DWELL }, { type: "tick", deltaMs: PACK });

  // Refine is gated: time alone does not move it, even with results queued.
  s = advance(s);
  assert.equal(s.phase.stage, "refine", "refine waits for Accept changes");
  s = reduce(s, { type: "accept", stage: "refine" }, { type: "tick", deltaMs: PACK });
  assert.equal(s.phase.stage, "match", "after accept, straight to Top matches");
  s = advance(s);
  assert.equal(s.phase.kind, "idle");
  assert.deepEqual(s.presented, ["explore", "refine", "match"]);
});

test("prepare settles in place and is never packed away", () => {
  let s = reduce(initialPresentationState(), { type: "stage_result", stage: "prepare" });
  assert.equal(s.phase.kind, "settled");
  assert.equal(s.phase.stage, "prepare");

  // No amount of elapsed time moves it.
  s = reduce(s, { type: "tick", deltaMs: DWELL * 100 });
  assert.equal(s.phase.kind, "settled");
  assert.equal(visibleStage(s, "prepare"), "prepare", "Bulk Apply stays mounted");
});

test("a duplicated stage.result after reconnect does not re-present the result", () => {
  let s = reduce(
    initialPresentationState(),
    { type: "stage_result", stage: "match" },
    { type: "tick", deltaMs: DWELL },
    { type: "tick", deltaMs: PACK },
  );
  assert.deepEqual(s.presented, ["match"]);

  const again = reduce(s, { type: "stage_result", stage: "match" });
  assert.equal(again.phase.kind, "idle", "no duplicate receipt, no replayed animation");
  assert.deepEqual(again.queue, []);
});

test("restore after refresh marks stages presented without replaying animation", () => {
  const s = reduce(initialPresentationState(), {
    type: "restore",
    presentedStages: ["refine", "explore"],
    settledStage: "prepare",
  });
  assert.deepEqual(s.presented, ["refine", "explore"]);
  assert.equal(s.phase.kind, "settled");
  assert.equal(isShowingResult(s, "prepare"), true);
  // A replayed event for an already-presented stage stays inert.
  assert.equal(reduce(s, { type: "stage_result", stage: "refine" }).queue.length, 0);
});

test("presentation can hold an earlier stage while the worker has moved on", () => {
  const s = reduce(initialPresentationState(), { type: "stage_result", stage: "refine" });
  // liveStage is what the worker reports; the visitor still sees refine.
  assert.equal(visibleStage(s, "match"), "refine");
  // With nothing queued, the live stage shows through.
  assert.equal(visibleStage(initialPresentationState(), "match"), "match");
});

test("reset returns to idle but preserves environment flags", () => {
  const s = reduce(
    initialPresentationState({ reducedMotion: true, foreground: false }),
    { type: "stage_result", stage: "refine" },
    { type: "reset" },
  );
  assert.equal(s.phase.kind, "idle");
  assert.deepEqual(s.presented, []);
  assert.equal(s.reducedMotion, true);
  assert.equal(s.foreground, false);
});

test("refine waits for Accept changes, however long the visitor reads", () => {
  let s = reduce(initialPresentationState(), { type: "stage_result", stage: "refine" });
  assert.equal(awaitingAcceptance(s, "refine"), true);

  s = reduce(s, { type: "tick", deltaMs: DWELL * 100 });
  assert.equal(s.phase.kind, "dwelling", "no timer advances a gated result");
  assert.equal(visibleStage(s, "explore"), "refine", "Explore Jobs stays closed");

  s = reduce(s, { type: "accept", stage: "refine" });
  assert.equal(s.phase.kind, "packing", "accepting packs it away immediately");
  assert.equal(awaitingAcceptance(s, "refine"), false);

  s = reduce(s, { type: "tick", deltaMs: PACK });
  assert.equal(s.phase.kind, "idle");
  assert.deepEqual(s.presented, ["refine"]);
  assert.equal(visibleStage(s, "explore"), "explore", "the live Explore stage shows through");
});

test("accepting under reduced motion moves straight on", () => {
  const s = reduce(
    initialPresentationState({ reducedMotion: true }),
    { type: "stage_result", stage: "refine" },
    { type: "stage_result", stage: "match" },
    { type: "accept", stage: "refine" },
  );
  assert.equal(s.phase.stage, "match");
  assert.deepEqual(s.presented, ["refine"]);
});

test("an acceptance restored before the result arrives still applies", () => {
  // Refresh: sessionStorage replays the accept before the refine result.
  let s = reduce(initialPresentationState(), { type: "accept", stage: "refine" });
  s = reduce(s, { type: "stage_result", stage: "refine" });
  assert.equal(awaitingAcceptance(s, "refine"), false, "no second ask");
  s = reduce(s, { type: "tick", deltaMs: DWELL }, { type: "tick", deltaMs: PACK });
  assert.equal(s.phase.kind, "idle");
});

test("reset clears acceptance for a new journey", () => {
  const s = reduce(
    initialPresentationState(),
    { type: "accept", stage: "refine" },
    { type: "reset" },
    { type: "stage_result", stage: "refine" },
  );
  assert.equal(awaitingAcceptance(s, "refine"), true);
});

test("explore's result never takes the screen away from the resume review", () => {
  let s = reduce(initialPresentationState(), { type: "stage_result", stage: "refine" });
  s = reduce(s, { type: "stage_result", stage: "explore" });
  assert.equal(s.phase.kind, "dwelling");
  assert.equal(s.phase.stage, "refine", "the review stays up while jobs finish");
  // Before refine finishes, a live explore stage shows the review screen too
  // (screens.ts maps explore → refine); presentation does not hold it.
  assert.equal(visibleStage(initialPresentationState(), "explore"), "explore");
});
