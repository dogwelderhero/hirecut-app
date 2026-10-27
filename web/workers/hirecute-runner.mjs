#!/usr/bin/env node
/**
 * The journey worker (child process entry).
 *
 * A child that receives an immutable codeRoot, a per-run dataRoot and the
 * run's scenario id, reports progress through the fixed IPC vocabulary, and
 * lets the parent own every write. WHICH steps run, and in what order, is the
 * scenario's (web/scenarios/<id>.json), executed by scenario-runner.mjs.
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

import { loadScenarioBundle, stepsDir, validateScenario } from "../src/lib/hirecute/scenarios.mjs";
import { executeScenario } from "./scenario-runner.mjs";

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
  // The parent fixed the scenario when it created the run; the worker never
  // chooses one, it only executes what run.json already records.
  const SCENARIO = process.env.HIRECUTE_SCENARIO;
  if (!SCENARIO) throw new Error("missing HIRECUTE_SCENARIO");

  diag({ started: { runId: RUN_ID, dataRoot: DATA_ROOT, scenario: SCENARIO } });

  const { scenario, manifests } = await loadScenarioBundle(CODE_ROOT, SCENARIO);
  const invalid = validateScenario(SCENARIO, scenario, manifests);
  if (invalid.length) throw new Error(`invalid scenario: ${invalid.join("; ")}`);

  const outcome = await executeScenario({
    scenario,
    manifests,
    stepsRoot: stepsDir(CODE_ROOT),
    builtins: { emit, diag, runDir: DATA_ROOT, codeRoot: CODE_ROOT },
    services: { utilityEnv },
  });
  // A step that stopped has already reported its error; without `done` the
  // parent marks the run interrupted, and the visitor retries in place.
  if (!outcome.ok) return;

  // Every step genuinely finished, so `run.done` is now the truth rather than
  // a claim. Nothing has been sent or charged.
  send({ kind: "done", resultStage: outcome.resultStage });
}

main().catch((err) => {
  diag({ fatal: err instanceof Error ? err.message : String(err) });
  send({ kind: "failed", message: "worker_error" });
  process.exit(1);
});
