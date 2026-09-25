/**
 * The parent side of worker IPC.
 *
 * The child sends a FIXED set of structured messages; the parent is the only
 * thing that writes `run.json` and `events.ndjson`. That asymmetry is the point
 * (01-architecture.md §6) — a child cannot allocate a sequence number, cannot
 * emit an event the parent has not validated, and cannot decide that a stage
 * completed without a durable result behind it.
 *
 * The message vocabulary is closed. Anything unrecognized is written to private
 * diagnostics and dropped, never relayed to the browser.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { EventPayloadMap, StageId } from "./contracts";
import {
  appendDiagnostic,
  appendEvent,
  readRunFile,
  registerArtifact,
  updateRun,
} from "@/lib/hirecute/store";
import { childEnv, codeRoot } from "@/lib/hirecute/paths";

/** Messages a child may send. Closed set. */
export type WorkerMessage =
  | { kind: "event"; type: keyof EventPayloadMap; payload: unknown; stage?: StageId | null }
  | { kind: "diagnostic"; entry: unknown }
  | { kind: "done" }
  | { kind: "failed"; message: string };

/** Public event types a CHILD is allowed to request. */
const CHILD_EMITTABLE = new Set<keyof EventPayloadMap>([
  "run.started",
  "stage.started",
  "stage.result",
  "stage.error",
  "action.started",
  "action.completed",
  "action.error",
  "job.discovered",
  "job.evaluated",
  "application.updated",
  "selection.updated",
  "letter.started",
  "letter.delta",
  "letter.completed",
  "letter.error",
]);

// Billing events are deliberately NOT in that set. A worker cannot grant
// credits or declare a card saved; only the billing module can.

export interface WorkerHandle {
  child: ChildProcess;
  cancel: () => void;
}

export function startWorker(runId: string): WorkerHandle {
  const entry = path.join(codeRoot(), "web", "workers", "hirecute-runner.mjs");

  // `spawn(process.execPath, [entry])` rather than `fork(entry)`: Turbopack
  // treats fork's first argument as a module specifier it must resolve at build
  // time, and this path is only known at runtime. "ipc" in stdio gives the same
  // channel fork would have.
  const child = spawn(process.execPath, [entry], {
    // The child's cwd is codeRoot so relative script resolution stays inside
    // the immutable checkout; its DATA root arrives via env.
    cwd: codeRoot(),
    // Cast: childEnv returns a plain allowlisted record, which is exactly
    // what fork() needs; NodeJS.ProcessEnv additionally demands NODE_ENV.
    // The journey worker is the one child granted the model credential.
    env: childEnv(runId, { HIRECUTE_RUN_ID: runId }, { model: true }) as NodeJS.ProcessEnv,
    // Argument array + IPC. No shell, so no user text can become a command.
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  child.on("message", (raw) => {
    void handleMessage(runId, raw as WorkerMessage);
  });

  // Child stderr/stdout are operator diagnostics, never public events. A model
  // or CLI log line must not reach a browser.
  child.stderr?.on("data", (buf: Buffer) =>
    void appendDiagnostic(runId, { stream: "stderr", text: buf.toString() }),
  );
  child.stdout?.on("data", (buf: Buffer) =>
    void appendDiagnostic(runId, { stream: "stdout", text: buf.toString() }),
  );

  child.on("exit", (code, signal) => {
    void (async () => {
      await appendDiagnostic(runId, { exit: { code, signal } });
      const file = await readRunFile(runId);
      if (!file) return;
      const status = file.snapshot.status;
      // A non-zero exit with no terminal record is interrupted, not success.
      // §6: "A stream ending is not success."
      if (status === "running" || status === "queued") {
        await updateRun(runId, (f) => ({
          ...f,
          snapshot: { ...f.snapshot, status: "interrupted" },
        }));
        await appendEvent(runId, "run.interrupted", {
          stage: file.snapshot.currentStage ?? "refine",
          canRetry: true,
        });
      }
    })();
  });

  return {
    child,
    cancel: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    },
  };
}

async function handleMessage(runId: string, message: WorkerMessage): Promise<void> {
  if (!message || typeof message !== "object" || !("kind" in message)) {
    await appendDiagnostic(runId, { rejected: "malformed worker message" });
    return;
  }

  switch (message.kind) {
    case "event": {
      if (!CHILD_EMITTABLE.has(message.type)) {
        // A worker asking to emit a billing or lifecycle event it does not own.
        await appendDiagnostic(runId, { rejected: "event type not child-emittable", type: message.type });
        return;
      }
      const file = await readRunFile(runId);
      if (!file) return;

      // Stale-write guard: a retry bumps journeyVersion, so a child from the
      // previous attempt cannot commit events against the new inputs.
      if (
        message.stage &&
        typeof message.payload === "object" &&
        message.payload !== null &&
        "inputVersion" in message.payload &&
        typeof (message.payload as { inputVersion: unknown }).inputVersion === "number" &&
        (message.payload as { inputVersion: number }).inputVersion <
          file.snapshot.stages[message.stage].inputVersion
      ) {
        await appendDiagnostic(runId, { rejected: "stale stage inputVersion", type: message.type });
        return;
      }

      // The parent owns the artifact registry, so a worker reports RELATIVE
      // PATHS and the IDs are minted here. A worker cannot mint an artifact ID,
      // which is what keeps `GET /artifacts/:id` resolvable only through the
      // owning run's registry.
      let payload = message.payload;
      if (message.type === "stage.result") {
        payload = await registerResultArtifacts(runId, payload);
      }

      await appendEvent(
        runId,
        message.type,
        payload as EventPayloadMap[keyof EventPayloadMap],
        message.stage ?? null,
      );
      return;
    }

    case "diagnostic":
      await appendDiagnostic(runId, message.entry);
      return;

    case "done":
      await updateRun(runId, (f) => ({
        ...f,
        snapshot: { ...f.snapshot, status: "preparation_complete" },
      }));
      await appendEvent(runId, "run.done", {
        outcome: "preparation_complete",
        resultStage: "prepare",
      });
      return;

    case "failed": {
      const file = await readRunFile(runId);
      await updateRun(runId, (f) => ({
        ...f,
        snapshot: { ...f.snapshot, status: "failed" },
      }));
      await appendEvent(runId, "run.error", {
        // The child's message is a sanitized code path, not a stack trace.
        error: {
          code: "internal_error",
          message: "Your agent stopped before finishing. You can retry the last step.",
          retryable: true,
          stage: file?.snapshot.currentStage ?? null,
          jobId: null,
        },
        lastCompletedStage: null,
      });
      return;
    }

    default:
      await appendDiagnostic(runId, { rejected: "unknown worker message kind" });
  }
}

/**
 * Replace the relative paths a worker reported with registered artifact IDs.
 *
 * Only known result shapes are touched. An unrecognized field is left alone
 * rather than guessed at, so a future stage cannot accidentally publish a path.
 */
async function registerResultArtifacts(runId: string, payload: unknown): Promise<unknown> {
  if (!payload || typeof payload !== "object") return payload;
  const p = payload as { result?: Record<string, unknown> };
  const result = p.result;
  if (!result || result.kind !== "refine") return payload;

  const register = async (relativePath: unknown, kind: string) => {
    if (typeof relativePath !== "string" || !relativePath) return null;
    const artifact = await registerArtifact(
      runId,
      {
        kind,
        createdAt: new Date().toISOString(),
        bytes: 0,
        contentHash: "",
      } as never,
      relativePath,
    );
    return artifact.id;
  };

  const originalId = await register(result.originalArtifactId, "original_resume");
  const refinedId = await register(result.refinedResumeArtifactId, "refined_resume_pdf");

  return {
    ...p,
    result: {
      ...result,
      originalArtifactId: originalId ?? result.originalArtifactId,
      refinedResumeArtifactId: refinedId ?? result.refinedResumeArtifactId,
    },
  };
}
