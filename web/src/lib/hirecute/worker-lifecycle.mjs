/**
 * How the parent listens to a worker child: in order, and to the very end.
 *
 * The parent reacts to a child through several callbacks, and each reaction is
 * an async read-modify-write of `run.json`. Fired with `void`, they interleave:
 * the child sends `done` and exits at once, the exit handler reads `run.json`
 * before the done handler has written `preparation_complete`, still sees
 * `running`, and marks a finished run `interrupted`. Observed on a local sample
 * run — `run.done` at seq 283, `run.interrupted` at seq 284, 7 ms apart.
 *
 * Two rules close it:
 *  1. Every handler runs through ONE serial queue, in the order Node emitted
 *     the events, each to completion. A handler that throws is reported and
 *     does not stall the ones queued after it.
 *  2. The exit handler is queued only after BOTH `exit` (the process ended) and
 *     `disconnect` (the IPC channel closed). Node delivers every message read
 *     from the channel before `disconnect`, while `exit` alone carries no such
 *     guarantee, so a terminal message can never land after the exit verdict.
 *     A grace timer still finalizes if `disconnect` never comes.
 */

/**
 * @param {(err: unknown) => void} [onError]
 */
export function createSerialQueue(onError = () => {}) {
  let tail = Promise.resolve();
  return {
    /** @param {() => unknown} task */
    run(task) {
      tail = tail.then(task).catch(onError);
      return tail;
    },
    idle() {
      return tail;
    },
  };
}

/**
 * @param {import("node:child_process").ChildProcess} child  spawned with an "ipc" stdio slot
 * @param {{
 *   onMessage: (raw: unknown) => unknown,
 *   onExit: (code: number | null, signal: string | null) => unknown,
 *   onError?: (err: unknown) => void,
 *   exitGraceMs?: number,
 * }} handlers
 */
export function superviseChild(child, { onMessage, onExit, onError, exitGraceMs = 2000 }) {
  const queue = createSerialQueue(onError);
  let exited = null;
  let channelClosed = !child.connected;
  let finalized = false;
  let grace = null;

  const finalize = () => {
    if (finalized || !exited || !channelClosed) return;
    finalized = true;
    if (grace) clearTimeout(grace);
    const { code, signal } = exited;
    void queue.run(() => onExit(code, signal));
  };

  child.on("message", (raw) => void queue.run(() => onMessage(raw)));
  child.on("disconnect", () => {
    channelClosed = true;
    finalize();
  });
  child.on("exit", (code, signal) => {
    exited = { code, signal };
    if (channelClosed) return finalize();
    grace = setTimeout(() => {
      channelClosed = true;
      finalize();
    }, exitGraceMs);
    grace.unref?.();
  });

  return queue;
}
