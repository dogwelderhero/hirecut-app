import { test } from "node:test";
import assert from "node:assert/strict";
import { withMatchProgress } from "../../workers/stages/match-classic.mjs";

test("match-classic@2 counts scored and given-up jobs of the shortlist, and keeps v1's events, diagnostics and result", async () => {
  const emitted = [];
  const diags = [];
  const fakeScoring = async (ctx) => {
    ctx.diag({ eligibility: { discovered: 40, withReadableJd: 30, shortlisted: 4, skippedNoJd: 10 } });
    ctx.emit("job.evaluated", { assessment: { jobId: "a", score5: 4 } }, "match");
    ctx.diag({ unscorable: { jobId: "b", reason: "model reported unreadable JD" } });
    ctx.emit("job.evaluated", { assessment: { jobId: "a", score5: 4 } }, "match"); // a repeat is not a second job
    ctx.diag({ unscored: { jobId: "c", reason: "no valid assessment within budget" } });
    ctx.diag({ budget: "model call budget exhausted", jobId: "d" });
    return { ok: true, assessments: ["a"] };
  };
  const run = withMatchProgress(fakeScoring);
  const out = await run({ emit: (type, payload) => emitted.push({ type, payload }), diag: (e) => diags.push(e) });

  assert.deepEqual(out, { ok: true, assessments: ["a"] });
  assert.equal(diags.length, 4, "every diagnostic still reaches the private log");
  assert.equal(emitted.filter((e) => e.type === "job.evaluated").length, 2, "v1's own events pass through");
  assert.deepEqual(
    emitted.filter((e) => e.type === "match.progress").map((e) => [e.payload.jobsDone, e.payload.jobsTotal]),
    [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]],
  );
});
