#!/usr/bin/env node
/**
 * The journey worker (child process entry).
 *
 * Milestone 2 establishes the PLUMBING: a child that receives an immutable
 * codeRoot and a per-run dataRoot, reports progress through the fixed IPC
 * vocabulary, and lets the parent own every write. The stage bodies still
 * replay the fixture timeline — real extraction, discovery, scoring and
 * document generation are milestones 3-6.
 *
 * Deliberate properties:
 *  - It never writes run.json or events.ndjson. It cannot allocate a sequence
 *    number, so it cannot forge an event ordering.
 *  - It reads its data root from CAREER_OPS_ROOT, which the parent set for this
 *    run alone. It does not know the value of any other run's root.
 *  - It holds no Stripe or model credential: the parent's childEnv() allowlist
 *    does not pass them, so a scanner or renderer cannot leak one.
 *  - Unhandled failures report `failed` and exit non-zero, which the parent
 *    turns into `interrupted`/`run.error`. Silence is never success.
 */

import process from "node:process";

const RUN_ID = process.env.HIRECUTE_RUN_ID;
const DATA_ROOT = process.env.CAREER_OPS_ROOT;

if (!RUN_ID || !DATA_ROOT) {
  // Without both, this process has no idea whose data it would touch.
  process.stderr.write("hirecute-runner: missing HIRECUTE_RUN_ID or CAREER_OPS_ROOT\n");
  process.exit(2);
}

function send(message) {
  // `process.send` is absent if this was launched without an IPC channel,
  // which would mean nothing can observe the work. Fail loudly instead.
  if (!process.send) {
    process.stderr.write("hirecute-runner: no IPC channel\n");
    process.exit(2);
  }
  process.send(message);
}

const emit = (type, payload, stage = null) => send({ kind: "event", type, payload, stage });
const diag = (entry) => send({ kind: "diagnostic", entry });

let cancelled = false;
process.on("SIGTERM", () => {
  cancelled = true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // Plain ESM, so a child process needs no type stripping to read it.
  const { fixtureTimeline } = await import("../src/lib/hirecute/fixture-journey.mjs");

  diag({ started: { runId: RUN_ID, dataRoot: DATA_ROOT } });

  const timeline = fixtureTimeline();
  let last = 0;
  for (const { at, event } of timeline) {
    if (cancelled) {
      diag({ cancelled: true });
      return;
    }
    // Preserve the scripted pacing without a wall-clock scheduler.
    await sleep(Math.max(0, at - last));
    last = at;

    // run.queued/run.done/run.error are lifecycle events the PARENT owns; the
    // child only reports the work in between.
    if (event.type === "run.queued" || event.type === "run.done" || event.type === "run.error") {
      continue;
    }
    const stage =
      typeof event.payload === "object" && event.payload !== null && "stage" in event.payload
        ? event.payload.stage
        : null;
    emit(event.type, event.payload, stage);
  }

  send({ kind: "done" });
}

main().catch((err) => {
  diag({ fatal: err instanceof Error ? err.message : String(err) });
  send({ kind: "failed", message: "worker_error" });
  process.exit(1);
});
