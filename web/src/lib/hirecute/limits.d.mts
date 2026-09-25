/** Types for `limits.mjs`. */
export const LIMITS: {
  activeWorkers: number;
  queuedRunsPerSession: number;
  maxQueueLength: number;
  maxUploadBytes: number;
  discoveryTargetMs: number;
  maxDiscoveredJobs: number;
  defaultScoredJobs: number;
  maxScoredJobs: number;
  maxConcurrentModelCalls: number;
  firstVisibleLetters: number;
  maxSelectedPackages: number;
  maxModelCallsPerRun: number;
  maxOutputTokensPerRun: number;
  maxRunWallClockMs: number;
};
export const PRESENTATION: {
  resultDwellMs: number;
  packMs: number;
  testimonialRotateMs: number;
  checkoutClickThreshold: number;
};
