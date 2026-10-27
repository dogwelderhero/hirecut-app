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

/**
 * Cancellation.
 *
 * Registering a SIGTERM handler REPLACES Node's default terminate, so a
 * handler that only sets a flag makes the process unkillable unless every
 * long-running step polls that flag. The stage bodies are model calls and
 * child renders that do not poll, so this handler exits for real.
 *
 * The flag still exists for the small window between the signal and exit, and
 * `exit(0)` rather than a non-zero code because an intentional cancel is not
 * a crash — the parent has already marked the run cancelled.
 */
let cancelled = false;
process.on("SIGTERM", () => {
  cancelled = true;
  diag({ cancelled: "SIGTERM received; stopping this run" });
  // A brief grace period lets a queued IPC write flush, then we go.
  setTimeout(() => process.exit(0), 250).unref?.();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The env this worker hands to a deterministic utility child.
 *
 * Same run-owned paths, but the model credential is stripped: build-cv-html
 * has no use for it, and a renderer that never holds a credential cannot leak
 * one.
 */
function utilityEnv() {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("HIRECUTE_MODEL") || k.startsWith("STRIPE_")) continue;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

async function main() {
  const CODE_ROOT = process.cwd();

  diag({ started: { runId: RUN_ID, dataRoot: DATA_ROOT } });

  // The journey is four visible steps, run in order so each step's actions
  // and results belong to it:
  //   1. refine  — read the resume into sections (no suggestions yet)
  //   2. explore + match — find jobs, score them, quote proof and gaps
  //   3. improve — resume changes built from those gaps
  //   4. recruiters — front-end only; no backend work
  const { runRefineStage } = await import("./stages/refine.mjs");
  const refined = await runRefineStage({
    emit,
    diag,
    runDir: DATA_ROOT,
    codeRoot: CODE_ROOT,
    env: utilityEnv(),
  });
  if (!refined.ok) {
    diag({ stopped: "refine stage failed" });
    return;
  }

  const { runExploreStage } = await import("./stages/explore.mjs");
  const explored = await runExploreStage({
    emit,
    diag,
    runDir: DATA_ROOT,
    codeRoot: CODE_ROOT,
    searchSeed: refined.searchSeed,
    preferences: {},
  });
  if (!explored.ok) {
    // An empty or failed search stays on the jobs screen with a scoped retry.
    diag({ stopped: "explore stage produced no usable result" });
    return;
  }

  const { runMatchStage } = await import("./stages/match.mjs");
  const matched = await runMatchStage({
    emit,
    diag,
    runDir: DATA_ROOT,
    codeRoot: CODE_ROOT,
    jobs: explored.jobs,
    sourceFactsPath: refined.sourceFactsPath,
    sourceResumeHash: refined.sourceResumeHash,
  });
  if (!matched.ok) {
    diag({ stopped: "match stage produced no usable assessment" });
    return;
  }

  const { runImproveStage } = await import("./stages/improve.mjs");
  const improved = await runImproveStage({
    emit,
    diag,
    runDir: DATA_ROOT,
    codeRoot: CODE_ROOT,
    resume: refined.resume,
    jobs: explored.jobs,
    assessments: matched.assessments,
    sourceFactsPath: refined.sourceFactsPath,
  });
  if (!improved.ok) {
    diag({ stopped: "improve stage failed" });
    return;
  }

  // Every agent step genuinely finished, so `run.done` is now the truth rather
  // than a claim. Nothing has been sent or charged.
  send({ kind: "done" });
}

main().catch((err) => {
  diag({ fatal: err instanceof Error ? err.message : String(err) });
  send({ kind: "failed", message: "worker_error" });
  process.exit(1);
});
