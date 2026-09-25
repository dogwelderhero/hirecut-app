/**
 * A bounded in-process queue (01-architecture.md §3).
 *
 * "Start with one active journey worker and one queued journey per anonymous
 * session ... Allow a small maximum queue and reject excess work politely.
 * This is a configuration change, not a distributed-job-system project."
 *
 * Two behaviours worth naming:
 *  - A queued run reports a genuine position. `run.queued` with a real
 *    `queuePosition` is what lets the UI say "Your agent is queued" instead of
 *    inventing an action that has not started.
 *  - The worker is NOT tied to a request's abort signal (§6). A browser
 *    disconnect leaves the child running within its budget; only an explicit
 *    DELETE cancels it.
 */

import { LIMITS } from "@/lib/hirecute/config";

export type QueueRejection = "queue_full" | "session_limit";

interface Entry {
  runId: string;
  sessionId: string;
  start: () => Promise<void>;
  cancel: () => void;
}

const waiting: Entry[] = [];
const active = new Map<string, Entry>();

export interface EnqueueResult {
  accepted: boolean;
  rejection?: QueueRejection;
  /** 0 while running; 1-based while waiting. */
  queuePosition: number | null;
}

export function enqueue(entry: Entry): EnqueueResult {
  const sessionRuns =
    waiting.filter((e) => e.sessionId === entry.sessionId).length +
    [...active.values()].filter((e) => e.sessionId === entry.sessionId).length;

  // One queued journey per session: a visitor cannot occupy the whole queue by
  // repeatedly uploading.
  if (sessionRuns >= LIMITS.queuedRunsPerSession + LIMITS.activeWorkers) {
    return { accepted: false, rejection: "session_limit", queuePosition: null };
  }
  if (waiting.length >= LIMITS.maxQueueLength) {
    return { accepted: false, rejection: "queue_full", queuePosition: null };
  }

  waiting.push(entry);
  const result: EnqueueResult = { accepted: true, queuePosition: positionOf(entry.runId) };
  void pump();
  return result;
}

function positionOf(runId: string): number | null {
  if (active.has(runId)) return 0;
  const index = waiting.findIndex((e) => e.runId === runId);
  return index === -1 ? null : index + 1;
}

export function queuePosition(runId: string): number | null {
  return positionOf(runId);
}

async function pump(): Promise<void> {
  while (active.size < LIMITS.activeWorkers && waiting.length > 0) {
    const entry = waiting.shift()!;
    active.set(entry.runId, entry);
    // Deliberately not awaited: `pump` schedules, the entry owns its lifetime.
    void entry
      .start()
      .catch(() => undefined)
      .finally(() => {
        active.delete(entry.runId);
        void pump();
      });
  }
}

/** Explicit cancellation (DELETE /runs/current). Removes queued or running work. */
export function cancel(runId: string): boolean {
  const index = waiting.findIndex((e) => e.runId === runId);
  if (index !== -1) {
    waiting.splice(index, 1);
    return true;
  }
  const running = active.get(runId);
  if (running) {
    running.cancel();
    active.delete(runId);
    void pump();
    return true;
  }
  return false;
}

export function isActive(runId: string): boolean {
  return active.has(runId);
}

/** Test seam: the queue is process-global, so suites must be able to reset it. */
export function __resetQueue(): void {
  waiting.length = 0;
  for (const entry of active.values()) entry.cancel();
  active.clear();
}
