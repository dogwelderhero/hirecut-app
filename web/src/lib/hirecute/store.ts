/**
 * Run persistence: atomic snapshots, the public event log, and artifacts.
 *
 * 01-architecture.md §6: "Write a durable result before its public completion
 * event. A worker returns structured IPC/status messages; the parent serializes
 * writes to `run.json` and `events.ndjson`."
 *
 * So: all writes funnel through this module in the parent process, each run has
 * a serialized write chain, and `appendEvent` is the ONLY way a sequence number
 * is allocated. Private diagnostics go to a separate file that no route reads.
 */

import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArtifactMetadata,
  EventPayloadMap,
  PublicRunEvent,
  RunSnapshot,
  Sequence,
  StageId,
} from "./contracts";
import { newArtifactId, paths, runDir } from "@/lib/hirecute/paths";
import { projectEvent } from "@/lib/hirecute/project";

/**
 * One promise chain per run serializes snapshot + event writes, so two
 * concurrent worker messages cannot interleave a read-modify-write and lose a
 * sequence number.
 */
const chains = new Map<string, Promise<unknown>>();

function serialize<T>(runId: string, task: () => Promise<T>): Promise<T> {
  const prev = chains.get(runId) ?? Promise.resolve();
  const next = prev.then(task, task);
  // Keep the chain alive but never let a rejection poison later writes.
  chains.set(
    runId,
    next.catch(() => undefined),
  );
  return next;
}

export interface PersistedRunFile {
  snapshot: RunSnapshot;
  ownerSessionId: string;
  /** Present once billing has created a record. Never sent to a browser. */
  billingRecordId: string | null;
  artifacts: Record<string, ArtifactMetadata & { relativePath: string }>;
}

export async function writeSnapshot(runId: string, file: PersistedRunFile): Promise<void> {
  await serialize(runId, async () => {
    const target = paths.snapshot(runId);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
    // Atomic replace: a reader sees either the old or the new file, never half.
    await rename(tmp, target);
  });
}

export async function readRunFile(runId: string): Promise<PersistedRunFile | null> {
  try {
    return JSON.parse(await readFile(paths.snapshot(runId), "utf8")) as PersistedRunFile;
  } catch {
    return null;
  }
}

/**
 * Mutate a run under its write lock.
 *
 * Every state change goes through here, so `lastSequence` and the snapshot can
 * never disagree about what has been emitted.
 */
export async function updateRun(
  runId: string,
  mutate: (file: PersistedRunFile) => PersistedRunFile,
): Promise<PersistedRunFile> {
  return serialize(runId, async () => {
    const current = await readRunFile(runId);
    if (!current) throw new Error("hirecute: run not found");
    const next = mutate(current);
    next.snapshot.updatedAt = new Date().toISOString();
    const target = paths.snapshot(runId);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await rename(tmp, target);
    return next;
  });
}

/**
 * Append one public event, allocating its sequence number.
 *
 * The snapshot's `lastSequence` and the log advance together under the same
 * lock. Callers MUST have written the durable result first: the event is the
 * announcement, not the commit.
 */
export async function appendEvent<K extends keyof EventPayloadMap>(
  runId: string,
  type: K,
  payload: EventPayloadMap[K],
  stage?: StageId | null,
): Promise<PublicRunEvent> {
  return serialize(runId, async () => {
    const file = await readRunFile(runId);
    if (!file) throw new Error("hirecute: run not found");

    const seq: Sequence = file.snapshot.lastSequence + 1;
    const event = {
      version: 1,
      runId,
      seq,
      time: new Date().toISOString(),
      input: {
        journeyVersion: file.snapshot.journeyVersion,
        sourceResumeHash: file.snapshot.profile ? file.snapshot.profile.sourceResumeHash : null,
        preferencesVersion: file.snapshot.preferences.version,
        stageInputVersion: stage ? file.snapshot.stages[stage].inputVersion : null,
        stageAttempt: stage ? file.snapshot.stages[stage].attempt : null,
      },
      type,
      payload,
    } as unknown as PublicRunEvent;

    await mkdir(runDir(runId), { recursive: true });
    await appendFile(paths.events(runId), `${JSON.stringify(event)}\n`, "utf8");

    // Project the event into the snapshot under the SAME lock, so run.json is
    // always a complete materialization of the log. Without this a refresh
    // restores a run with a sequence counter and no jobs.
    file.snapshot = projectEvent(file.snapshot, { type, payload } as never);
    file.snapshot.lastSequence = seq;
    file.snapshot.updatedAt = event.time;
    const target = paths.snapshot(runId);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
    await rename(tmp, target);

    return event;
  });
}

/**
 * Read events after a cursor.
 *
 * A malformed line is skipped rather than failing the stream: a partially
 * written final line during an append is a normal race, not a reason to drop a
 * reconnecting client.
 */
export async function readEventsAfter(runId: string, after: Sequence): Promise<PublicRunEvent[]> {
  let raw: string;
  try {
    raw = await readFile(paths.events(runId), "utf8");
  } catch {
    return [];
  }
  const out: PublicRunEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as PublicRunEvent;
      if (event.seq > after) out.push(event);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Operator diagnostics.
 *
 * Deliberately a different file with no reader in `src/app/api`: the brief
 * requires private diagnostics to live "outside the streamed log", and the way
 * to guarantee that is for the streaming route to have no way to reach them.
 */
export async function appendDiagnostic(runId: string, entry: unknown): Promise<void> {
  try {
    await mkdir(path.dirname(paths.diagnostics(runId)), { recursive: true });
    await appendFile(
      paths.diagnostics(runId),
      `${JSON.stringify({ time: new Date().toISOString(), entry })}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never break a run.
  }
}

/** Register an artifact by generated ID. The relative path never leaves the server. */
export async function registerArtifact(
  runId: string,
  meta: Omit<ArtifactMetadata, "id">,
  relativePath: string,
): Promise<ArtifactMetadata> {
  const id = newArtifactId();
  const full: ArtifactMetadata = { ...meta, id } as ArtifactMetadata;
  await updateRun(runId, (file) => ({
    ...file,
    artifacts: { ...file.artifacts, [id]: { ...full, relativePath } },
    snapshot: { ...file.snapshot, artifacts: [...file.snapshot.artifacts, full] },
  }));
  return full;
}

/**
 * The browser-facing snapshot.
 *
 * `ownerSessionId`, `billingRecordId` and every artifact's `relativePath` are
 * stripped here rather than at each call site, so a new route cannot leak them
 * by forgetting.
 */
export function sanitizeSnapshot(file: PersistedRunFile): RunSnapshot {
  return file.snapshot;
}
