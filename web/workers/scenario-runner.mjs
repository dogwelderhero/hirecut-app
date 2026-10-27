/**
 * Executes one scenario: its steps in dependency order, each fed ONLY from the
 * run context through its manifest's contract.
 *
 * A step never sees another step's return value directly. It receives the
 * built-in services (emit, diag, runDir, codeRoot), the named services its
 * manifest asks for, its `defaults`, and the context keys listed in `reads`;
 * the fields its manifest lists in `writes` go back into the context. That
 * contract is what makes a step runnable on its own (from a context fixture)
 * and swappable per scenario without touching its neighbours.
 *
 * Outcomes, unchanged from the hand-written runner this replaces:
 *   - a step returning {ok: false} has already reported its own error event;
 *     the scenario stops there without `done` (the parent marks it interrupted)
 *   - a broken contract (missing input, missing output, no such export) is a
 *     bug in code or config, so it THROWS and the run fails loudly
 */

import path from "node:path";
import { pathToFileURL } from "node:url";

import { topoOrder } from "../src/lib/hirecute/scenarios.mjs";

export class StepContractError extends Error {
  constructor(ref, message) {
    super(`${ref}: ${message}`);
    this.name = "StepContractError";
    this.step = ref;
  }
}

const optional = (key) => key.endsWith("?");
const bare = (key) => (optional(key) ? key.slice(0, -1) : key);

/**
 * @param {object} opts
 * @param {{pipeline: Array<{step: string, after?: string[]}>, resultStage: string}} opts.scenario
 * @param {Record<string, object>} opts.manifests     ref → step manifest
 * @param {string} opts.stepsRoot                      dir manifests' `module` paths are relative to
 * @param {{emit: Function, diag: Function, runDir: string, codeRoot: string}} opts.builtins
 * @param {Record<string, () => unknown>} [opts.services]  named service factories (utilityEnv, ...)
 * @param {Map<string, unknown>} [opts.context]       pre-seeded context (a fixture, or a resumed run)
 * @param {(url: string) => Promise<object>} [opts.importModule]
 * @param {() => number} [opts.now]
 * @returns {Promise<{ok: true, resultStage: string, context: Map<string, unknown>} | {ok: false, step: string, context: Map<string, unknown>}>}
 */
export async function executeScenario(opts) {
  const {
    scenario,
    manifests,
    stepsRoot,
    builtins,
    services = {},
    context = new Map(),
    importModule = (url) => import(url),
    now = Date.now,
  } = opts;

  const order = topoOrder(scenario);
  if (!order) throw new StepContractError("scenario", "steps form a cycle");

  for (const ref of order) {
    const m = manifests[ref];
    if (!m) throw new StepContractError(ref, "no manifest");

    const mod = await importModule(pathToFileURL(path.resolve(stepsRoot, m.module)).href);
    const fn = mod[m.export];
    if (typeof fn !== "function") throw new StepContractError(ref, `${m.module} has no export ${m.export}`);

    const ctx = { ...builtins, ...(m.defaults ?? {}) };
    for (const [arg, svc] of Object.entries(m.services ?? {})) {
      if (typeof services[svc] !== "function") throw new StepContractError(ref, `service ${svc} is not provided`);
      ctx[arg] = services[svc]();
    }
    for (const [arg, key] of Object.entries(m.reads ?? {})) {
      const k = bare(key);
      if (context.has(k)) ctx[arg] = context.get(k);
      else if (!optional(key) && !(arg in (m.defaults ?? {}))) {
        throw new StepContractError(ref, `input "${k}" (${arg}) is not in the run context`);
      }
    }

    const started = now();
    builtins.diag({ step: { ref, phase: "start" } });
    const result = await fn(ctx);
    const ms = now() - started;

    if (!result?.ok) {
      builtins.diag({ step: { ref, phase: "stopped", ms } });
      return { ok: false, step: ref, context };
    }
    for (const [field, key] of Object.entries(m.writes ?? {})) {
      if (result[field] === undefined) {
        if (optional(key)) continue;
        throw new StepContractError(ref, `returned ok without "${field}" (→ ${bare(key)})`);
      }
      context.set(bare(key), result[field]);
    }
    builtins.diag({ step: { ref, phase: "done", ms } });
  }

  return { ok: true, resultStage: scenario.resultStage, context };
}
