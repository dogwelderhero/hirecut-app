import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createSerialQueue, superviseChild } from "../../src/lib/hirecute/worker-lifecycle.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real child with an IPC channel, running `body` as its whole program. */
function child(body) {
  return spawn(process.execPath, ["-e", body], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
}

/**
 * The run.json logic of worker-host, reduced to its shape: `done` is a slow
 * write, and the exit verdict is a read-modify-write — it READS the status,
 * awaits I/O, then writes `interrupted` if what it read was `running`. That
 * stale read is the bug: unserialized, it overwrites a `done` that landed in
 * between.
 */
function supervise(proc, { doneWriteMs = 30 } = {}) {
  const state = { status: "running", seen: [] };
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));
  superviseChild(proc, {
    onMessage: async (raw) => {
      state.seen.push(raw.kind);
      if (raw.kind === "done") {
        await delay(doneWriteMs);
        state.status = "preparation_complete";
      }
    },
    onExit: async (code) => {
      const read = state.status;
      await delay(doneWriteMs + 10);
      if (read === "running") state.status = "interrupted";
      state.code = code;
      resolveExit();
    },
  });
  return { state, exited };
}

test("a done sent right before a natural exit is never overruled by the exit verdict", async () => {
  for (let i = 0; i < 20; i++) {
    const { state, exited } = supervise(child('process.send({ kind: "done" })'));
    await exited;
    assert.equal(state.status, "preparation_complete", `attempt ${i}`);
    assert.deepEqual(state.seen, ["done"]);
  }
});

test("a done followed by an explicit process.exit is not lost either", async () => {
  for (let i = 0; i < 10; i++) {
    const { state, exited } = supervise(
      child('process.send({ kind: "done" }, () => process.exit(0))'),
    );
    await exited;
    assert.equal(state.status, "preparation_complete", `attempt ${i}`);
  }
});

test("an exit with no terminal message is still interrupted", async () => {
  const { state, exited } = supervise(child('process.send({ kind: "event" }); process.exitCode = 1'));
  await exited;
  assert.equal(state.status, "interrupted");
  assert.equal(state.code, 1);
});

test("messages are handled in emission order, each to completion, before the exit verdict", async () => {
  const order = [];
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));
  superviseChild(child("for (let n = 1; n <= 5; n++) process.send({ n })"), {
    onMessage: async (raw) => {
      await delay(5 * (6 - raw.n)); // later messages finish faster if run concurrently
      order.push(raw.n);
    },
    onExit: () => {
      order.push("exit");
      resolveExit();
    },
  });
  await exited;
  assert.deepEqual(order, [1, 2, 3, 4, 5, "exit"]);
});

test("exit before the last message: the verdict waits for the channel to close", async () => {
  const fake = Object.assign(new EventEmitter(), { connected: true });
  const state = { status: "running" };
  let resolveExit;
  const exited = new Promise((resolve) => (resolveExit = resolve));
  superviseChild(fake, {
    onMessage: async () => {
      await delay(10);
      state.status = "preparation_complete";
    },
    onExit: () => {
      if (state.status === "running") state.status = "interrupted";
      resolveExit();
    },
  });
  fake.emit("exit", 0, null);
  fake.emit("message", { kind: "done" });
  fake.emit("disconnect");
  await exited;
  assert.equal(state.status, "preparation_complete");
});

test("if the channel never reports closing, the grace timer still finalizes", async () => {
  const fake = Object.assign(new EventEmitter(), { connected: true });
  let verdicts = 0;
  superviseChild(fake, { onMessage: () => {}, onExit: () => verdicts++, exitGraceMs: 20 });
  fake.emit("exit", null, "SIGKILL");
  await delay(60);
  fake.emit("disconnect"); // late: must not produce a second verdict
  await delay(10);
  assert.equal(verdicts, 1);
});

test("a handler that throws is reported and does not stall the queue", async () => {
  const errors = [];
  const ran = [];
  const queue = createSerialQueue((err) => errors.push(err.message));
  queue.run(() => ran.push("a"));
  queue.run(() => {
    throw new Error("boom");
  });
  queue.run(async () => {
    await delay(5);
    ran.push("c");
  });
  await queue.idle();
  assert.deepEqual(ran, ["a", "c"]);
  assert.deepEqual(errors, ["boom"]);
});
