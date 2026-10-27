/** Types for `worker-lifecycle.mjs`. */
import type { ChildProcess } from "node:child_process";

export interface SerialQueue {
  run: (task: () => unknown) => Promise<void>;
  idle: () => Promise<void>;
}

export function createSerialQueue(onError?: (err: unknown) => void): SerialQueue;

export function superviseChild(
  child: ChildProcess,
  handlers: {
    onMessage: (raw: unknown) => unknown;
    onExit: (code: number | null, signal: NodeJS.Signals | null) => unknown;
    onError?: (err: unknown) => void;
    exitGraceMs?: number;
  },
): SerialQueue;
