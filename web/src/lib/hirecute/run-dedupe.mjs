/**
 * Duplicate submission: when sending the same resume again reuses the run.
 *
 * A double click, a resend or a second tab must not throw away a run that is
 * already working (or done) on exactly this file — every one of its model
 * calls would be paid for twice. A DIFFERENT file is a deliberate restart, and
 * so is the same file after "Start over" (that run is cancelled) or after it
 * failed, or under another scenario.
 */

import { createHash } from "node:crypto";

/** Content hash of what the visitor sent (file bytes, pasted text, the sample). */
export function sourceHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const REUSABLE = new Set(["queued", "running", "preparation_complete"]);

/**
 * @param {{sourceHash?: string, snapshot: {status: string, scenario?: {id: string}}} | null} prior  the session's current run file
 * @param {{hash: string, scenarioId: string}} next
 * @returns {boolean}
 */
export function canReuseRun(prior, next) {
  if (!prior || !prior.sourceHash) return false;
  return (
    prior.sourceHash === next.hash &&
    prior.snapshot?.scenario?.id === next.scenarioId &&
    REUSABLE.has(prior.snapshot.status)
  );
}
