/**
 * Run lifecycle: create, restore, retry, cancel.
 *
 * Sits between the routes and the store so every route shares one definition
 * of "a run exists, this session owns it, and here is its sanitized state".
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ApplicationSelection,
  PublicError,
  RunOrigin,
  RunSnapshot,
  StageId,
  StageState,
} from "./contracts";
import { LIMITS, launchProfile } from "@/lib/hirecute/config";
import { bootstrapRunDir, newRunId, paths } from "@/lib/hirecute/paths";
import {
  appendEvent,
  readRunFile,
  updateRun,
  writeSnapshot,
  type PersistedRunFile,
} from "@/lib/hirecute/store";
import { cancel as cancelQueued, enqueue, queuePosition } from "@/lib/hirecute/queue";
import { startWorker, type WorkerHandle } from "@/lib/hirecute/worker-host";
import { setCurrentRun } from "@/lib/hirecute/session";
import { ownsRun, type SessionRecord } from "@/lib/hirecute/ownership";
import { STAGE_ORDER } from "@/lib/hirecute/screens";

const handles = new Map<string, WorkerHandle>();

function emptyStage(stage: StageId): StageState {
  return {
    stage,
    status: "pending",
    inputVersion: 1,
    inputHash: "",
    attempt: 0,
    actions: [],
    result: null,
    error: null,
  };
}

function emptySelection(): ApplicationSelection {
  return { jobIds: [], version: 1, updatedAt: new Date().toISOString() };
}

export function publicError(
  code: PublicError["code"],
  message: string,
  opts: { retryable?: boolean; stage?: StageId | null; jobId?: string | null } = {},
): PublicError {
  return {
    code,
    message,
    retryable: opts.retryable ?? false,
    stage: opts.stage ?? null,
    jobId: opts.jobId ?? null,
  };
}

export interface CreateRunOptions {
  session: SessionRecord;
  origin: RunOrigin;
  /** Original bytes, when the visitor uploaded a file. */
  original?: { fileName: string; bytes: Buffer };
  confirmedTargetRoles?: string[];
  confirmedLocations?: string[];
}

export interface CreateRunOutcome {
  runId: string;
  queuePosition: number | null;
  rejected?: "queue_full" | "session_limit";
}

export async function createRun(opts: CreateRunOptions): Promise<CreateRunOutcome> {
  const runId = newRunId();
  await bootstrapRunDir(runId);

  // The original is preserved under a SERVER-generated basename. The visitor's
  // file name is metadata only — it never becomes a path.
  if (opts.original) {
    const ext = opts.original.fileName.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
    await writeFile(path.join(paths.originals(runId), `resume.${ext}`), opts.original.bytes);
  }

  const now = new Date().toISOString();
  const snapshot: RunSnapshot = {
    schemaVersion: 1,
    id: runId,
    origin: opts.origin,
    launchProfile: launchProfile(),
    status: "queued",
    currentStage: null,
    createdAt: now,
    updatedAt: now,
    lastSequence: 0,
    journeyVersion: 1,
    profile: null,
    preferences: {
      version: 1,
      // Unconfirmed preferences stay BROAD rather than inheriting a default
      // salary band or asserting work authorization from a CV's location.
      targetRoles: opts.confirmedTargetRoles ?? [],
      locations: opts.confirmedLocations ?? [],
      workStyles: [],
      // "confirmed_by_candidate" only when they actually confirmed something;
      // otherwise the preference is a suggestion and stays broad.
      origin:
        opts.confirmedTargetRoles || opts.confirmedLocations
          ? "confirmed_by_candidate"
          : "suggested_from_resume",
    },
    stages: {
      refine: emptyStage("refine"),
      explore: emptyStage("explore"),
      match: emptyStage("match"),
      prepare: emptyStage("prepare"),
    },
    evidence: [],
    jobs: [],
    assessments: [],
    applications: [],
    selection: emptySelection(),
    artifacts: [],
    billing: {
      status: "not_started",
      mode: "test",
      promotionalCredit: null,
      entitlement: null,
      amountChargedMinor: 0,
      error: null,
    },
  } as unknown as RunSnapshot;

  const file: PersistedRunFile = {
    snapshot,
    ownerSessionId: opts.session.id,
    billingRecordId: null,
    artifacts: {},
  };
  await writeSnapshot(runId, file);
  await setCurrentRun(opts.session, runId);

  const result = enqueue({
    runId,
    sessionId: opts.session.id,
    start: async () => {
      await updateRun(runId, (f) => ({
        ...f,
        snapshot: { ...f.snapshot, status: "running", currentStage: "refine" },
      }));
      await appendEvent(runId, "run.started", { stage: "refine" });
      const handle = startWorker(runId);
      handles.set(runId, handle);
      await new Promise<void>((resolve) => handle.child.on("exit", () => resolve()));
      handles.delete(runId);
    },
    cancel: () => handles.get(runId)?.cancel(),
  });

  if (!result.accepted) {
    await updateRun(runId, (f) => ({ ...f, snapshot: { ...f.snapshot, status: "failed" } }));
    return { runId, queuePosition: null, rejected: result.rejection };
  }

  await appendEvent(runId, "run.queued", { queuePosition: result.queuePosition });
  return { runId, queuePosition: result.queuePosition };
}

/** The owned current run, or null. Ownership comes from the cookie, never an ID. */
export async function currentRunFor(session: SessionRecord | null): Promise<PersistedRunFile | null> {
  if (!session?.currentRunId) return null;
  const file = await readRunFile(session.currentRunId);
  if (!file) return null;
  // Belt and braces: the session record and the run file must agree.
  if (file.ownerSessionId !== session.id) return null;
  return file;
}

export async function ownedRun(
  session: SessionRecord | null,
  runId: string,
): Promise<PersistedRunFile | null> {
  if (!session || !ownsRun(session, runId)) return null;
  const file = await readRunFile(runId);
  if (!file || file.ownerSessionId !== session.id) return null;
  return file;
}

/** Live queue position, so a queued run reports a genuine place in line. */
export function livePosition(runId: string): number | null {
  return queuePosition(runId);
}

/**
 * Retry ONE failed or interrupted stage.
 *
 * §6: "Retry from the last saved stage, keyed by run, stage and input hash;
 * reuse finished artifacts." Bumping `journeyVersion` and the stage's
 * `inputVersion` is what makes the previous attempt's in-flight events stale,
 * so a zombie child cannot commit against the new inputs.
 */
export async function retryStage(
  runId: string,
  stage: StageId,
  inputVersion: number,
): Promise<{ ok: true } | { ok: false; error: PublicError; currentVersion?: number }> {
  const file = await readRunFile(runId);
  if (!file) return { ok: false, error: publicError("not_found", "That run no longer exists.") };

  const current = file.snapshot.stages[stage];
  if (current.inputVersion !== inputVersion) {
    return {
      ok: false,
      error: publicError("version_conflict", "That step has already moved on. Reloading."),
      currentVersion: current.inputVersion,
    };
  }
  if (current.status !== "failed" && current.status !== "interrupted") {
    // Retrying a successful stage would redo paid work for no reason.
    return {
      ok: false,
      error: publicError("missing_input", "That step has not failed, so there is nothing to retry."),
    };
  }

  await updateRun(runId, (f) => ({
    ...f,
    snapshot: {
      ...f.snapshot,
      status: "queued",
      journeyVersion: f.snapshot.journeyVersion + 1,
      stages: {
        ...f.snapshot.stages,
        [stage]: {
          ...f.snapshot.stages[stage],
          status: "queued",
          inputVersion: f.snapshot.stages[stage].inputVersion + 1,
          attempt: f.snapshot.stages[stage].attempt + 1,
          error: null,
        },
      },
    },
  }));
  await appendEvent(runId, "stage.started", {
    stage,
    inputVersion: inputVersion + 1,
    attempt: current.attempt + 1,
  });
  return { ok: true };
}

/** DELETE: stop owned work and drop the run from the session. */
export async function deleteRun(session: SessionRecord, runId: string): Promise<void> {
  cancelQueued(runId);
  handles.get(runId)?.cancel();
  handles.delete(runId);
  const file = await readRunFile(runId);
  if (file) {
    await updateRun(runId, (f) => ({ ...f, snapshot: { ...f.snapshot, status: "cancelled" } }));
    await appendEvent(runId, "run.cancelled", { reason: "candidate_deleted_run" });
  }
  await setCurrentRun(session, null);
}

/**
 * On process start, any run still marked running/queued is a casualty of the
 * restart. §6: mark it interrupted and offer ONE explicit retry — do not
 * promise durable background execution across restarts.
 */
export async function markInterruptedOnBoot(runIds: string[]): Promise<void> {
  for (const runId of runIds) {
    const file = await readRunFile(runId);
    if (!file) continue;
    if (file.snapshot.status !== "running" && file.snapshot.status !== "queued") continue;
    await updateRun(runId, (f) => ({
      ...f,
      snapshot: { ...f.snapshot, status: "interrupted" },
    }));
    await appendEvent(runId, "run.interrupted", {
      stage: file.snapshot.currentStage ?? STAGE_ORDER[0],
      canRetry: true,
    });
  }
}

export const RUN_LIMITS = LIMITS;
