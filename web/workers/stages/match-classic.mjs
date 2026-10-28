/**
 * Match for the vacancy journey, v2: the frozen production scoring
 * (legacy/v1, 01083211) unchanged, plus public progress per shortlisted job.
 *
 * v1 publishes each scored job (`job.evaluated`) but keeps the shortlist size
 * and the jobs it gives up on in private diagnostics, so the screen could not
 * say "3 of 10". This wrapper counts both and publishes `match.progress`.
 * The scoring, its results and its writes are v1's.
 */

import { runMatchStage as runFrozenMatch } from "../legacy/v1/stages/match.mjs";

/** Diagnostics in which v1 gives up on one shortlisted job (it stays visible, unscored). */
function settledJobId(entry) {
  return entry?.unscored?.jobId ?? entry?.unscorable?.jobId ?? (entry?.budget ? entry.jobId : undefined);
}

/**
 * Wrap a scoring stage so its shortlist and per-job outcomes become public progress.
 * @param {(ctx: object) => Promise<object>} runScoring
 */
export function withMatchProgress(runScoring) {
  return async (ctx) => {
    let jobsTotal = null;
    const settled = new Set();
    const report = () => {
      if (jobsTotal !== null) ctx.emit("match.progress", { jobsDone: settled.size, jobsTotal }, "match");
    };
    const settle = (jobId) => {
      if (typeof jobId !== "string" || settled.has(jobId)) return;
      settled.add(jobId);
      report();
    };

    const emit = (type, payload, stage) => {
      ctx.emit(type, payload, stage);
      if (type === "job.evaluated") settle(payload?.assessment?.jobId);
    };
    const diag = (entry) => {
      ctx.diag(entry);
      if (typeof entry?.eligibility?.shortlisted === "number") {
        jobsTotal = entry.eligibility.shortlisted;
        report();
      }
      settle(settledJobId(entry));
    };

    return runScoring({ ...ctx, emit, diag });
  };
}

export const runMatchStage = withMatchProgress(runFrozenMatch);
