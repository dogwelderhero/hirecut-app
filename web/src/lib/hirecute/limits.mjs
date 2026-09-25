/**
 * Pilot limits — plain ESM so the worker can import them.
 *
 * `config.ts` re-exports these for the typed/server side. Keeping the values
 * here means the worker does not need type stripping to read a budget.
 */
export const LIMITS = {
  activeWorkers: 1,
  queuedRunsPerSession: 1,
  maxQueueLength: 8,
  maxUploadBytes: 10 * 1024 * 1024,
  /** Discovery target, not a hard kill: partial coverage is a real result. */
  discoveryTargetMs: 45_000,
  /** Postings retained from discovery before scoring narrows further. */
  maxDiscoveredJobs: 40,
  defaultScoredJobs: 10,
  maxScoredJobs: 20,
  maxConcurrentModelCalls: 2,
  firstVisibleLetters: 5,
  maxSelectedPackages: 20,
  maxModelCallsPerRun: 60,
  maxOutputTokensPerRun: 120_000,
  maxRunWallClockMs: 15 * 60_000,
};

export const PRESENTATION = {
  resultDwellMs: 2_000,
  packMs: 780,
  testimonialRotateMs: 7_000,
  checkoutClickThreshold: 4,
};
