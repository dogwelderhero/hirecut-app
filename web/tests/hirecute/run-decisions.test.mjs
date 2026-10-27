import { test } from "node:test";
import assert from "node:assert/strict";

import { DECISION_LIMITS, mergeDecisions, validateDecisionPatch } from "../../src/lib/hirecute/run-decisions.mjs";

test("a patch is an object of plain keys; anything else is refused", () => {
  assert.deepEqual(validateDecisionPatch({ decisions: { "recruiter.applied": ["r1"] } }), { ok: true, patch: { "recruiter.applied": ["r1"] } });
  for (const body of [null, {}, { decisions: [] }, { decisions: "x" }]) assert.equal(validateDecisionPatch(body).ok, false);
  assert.match(validateDecisionPatch({ decisions: { "../etc": 1 } }).error, /Unknown decision/);
  assert.match(validateDecisionPatch({ decisions: { "Recruiter.Applied": 1 } }).error, /Unknown decision/);
});

test("merge overwrites keys, null deletes, untouched keys stay", () => {
  const r = mergeDecisions({ a: [1], b: true }, { a: [1, 2], b: null, c: "x" });
  assert.deepEqual(r, { ok: true, decisions: { a: [1, 2], c: "x" } });
});

test("limits apply to the merged record, not the patch", () => {
  const many = Object.fromEntries(Array.from({ length: DECISION_LIMITS.maxKeys }, (_, i) => [`k${i}`, 1]));
  assert.match(mergeDecisions(many, { extra: 1 }).error, /Too many decisions/);
  const big = "x".repeat(DECISION_LIMITS.maxBytes);
  assert.match(mergeDecisions({}, { a: big }).error, /too large/);
});
