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

/**
 * The env this worker hands to a deterministic utility child.
 *
 * Same run-owned paths, but the model credential is stripped: build-cv-html,
 * generate-pdf and verify-cv-facts have no use for it, and a renderer that
 * never holds a credential cannot leak one.
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

  // ── Stage 1: refine. REAL (milestone 3). ────────────────────────────────
  const { runRefineStage } = await import("./stages/refine.mjs");
  const refined = await runRefineStage({
    emit,
    diag,
    runDir: DATA_ROOT,
    codeRoot: CODE_ROOT,
    env: utilityEnv(),
  });

  // An inline stage failure is terminal for this attempt; the visitor retries
  // that stage in place rather than the whole journey.
  if (!refined.ok) {
    diag({ stopped: "refine stage failed" });
    return;
  }

  // ── Stage 2: explore. REAL (milestone 4). ───────────────────────────────
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
    // An empty or failed search stays in Explore Jobs with a scoped retry; it
    // does not advance to a pretend shortlist.
    diag({ stopped: "explore stage produced no usable result" });
    return;
  }

  // ── Stage 3: match. REAL (milestone 5). ────────────────────────────────
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
    // An unscorable shortlist stays in Top Matches with a scoped retry. The
    // discovered roles remain real, visible and openable.
    diag({ stopped: "match stage produced no usable assessment" });
    return;
  }

  // ── Stage 4: prepare. NOT YET IMPLEMENTED (milestone 6). ───────────────
  //
  // The fixture timeline is deliberately NOT replayed. It would attach invented
  // letters and "Ready to apply" badges to jobs that have just been REALLY
  // scored, and the brief is explicit: "never silently fall back to mock
  // results when a real provider or model fails." A fixture letter beside a
  // genuine 88% ring is indistinguishable from a real one to the visitor, which
  // makes it the most damaging available shortcut.
  //
  // So the run stops with `capability_disabled` on prepare and does NOT send
  // `run.done`: that means `preparation_complete`, and preparation never ran.
  // Claiming it did is precisely the false terminal the event protocol exists
  // to prevent. Every real artifact from stages 1-3 is retained.
  diag({ handover: { scored: matched.assessments.length, ranked: matched.ranked.length } });

  emit(
    "stage.error",
    {
      stage: "prepare",
      inputVersion: 1,
      error: {
        code: "capability_disabled",
        message:
          "Preparing tailored applications is not enabled on this deployment yet. Your refined resume and your ranked matches are saved, and you can open any posting.",
        retryable: false,
        stage: "prepare",
        jobId: null,
      },
    },
    "prepare",
  );

  diag({ stopped: "prepare stage not implemented (milestone 6)" });
}

main().catch((err) => {
  diag({ fatal: err instanceof Error ? err.message : String(err) });
  send({ kind: "failed", message: "worker_error" });
  process.exit(1);
});
