/**
 * Scenarios: which steps a run executes, in what order, chosen per visitor.
 *
 *   web/scenarios/<id>.json            a scenario: steps (a DAG via `after`) + resultStage
 *   web/workers/steps/<id>@<v>.json    a step manifest: module, export, and its
 *                                      contract — the context keys it reads and writes
 *
 * Which scenarios are switched on, and how traffic splits between them, is
 * deployment config, not code: HIRECUTE_SCENARIOS="vacancy=50;recruiter=50".
 * A scenario not listed there does not exist for visitors. Weight 0 = reachable
 * only by an explicit link, never by the split. The query parameter that picks
 * one is HIRECUTE_SCENARIO_PARAM.
 *
 * Plain ESM so the worker, the server and preflight share one implementation.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/** Snapshot stage slots a step may report into (contracts.ts StageId). */
export const STAGE_SLOTS = ["refine", "explore", "match", "improve", "prepare"];

/** Services the runner injects into every step, whatever its manifest says. */
export const BUILTIN_SERVICES = ["emit", "diag", "runDir", "codeRoot"];
/** Services a manifest may request by name. */
export const NAMED_SERVICES = ["utilityEnv"];
/** Runtime components a step may declare it needs (preflight checks them). */
export const REQUIREMENTS = ["chromium"];

export const COOKIE = "hc_scn";

const ID = /^[a-z][a-z0-9-]*$/;
const REF = /^([a-z][a-z0-9-]*)@(\d+)$/;

export function scenariosDir(codeRoot) {
  return path.join(codeRoot, "web", "scenarios");
}
export function stepsDir(codeRoot) {
  return path.join(codeRoot, "web", "workers", "steps");
}

// ── Deployment config ─────────────────────────────────────────────────────────

/**
 * Parse HIRECUTE_SCENARIOS. Format `id=weight;id=weight`, weights are integers
 * >= 0 summing to exactly 100.
 *
 * @returns {{ok: true, entries: Array<{id: string, weight: number}>} | {ok: false, error: string}}
 */
export function parseScenariosEnv(value) {
  if (!value || !value.trim()) return { ok: false, error: "HIRECUTE_SCENARIOS is not set" };
  const entries = [];
  for (const raw of value.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^([^=\s]+)\s*=\s*(\d+)$/.exec(part);
    if (!m) return { ok: false, error: `"${part}" is not id=weight` };
    const [, id, w] = m;
    if (!ID.test(id)) return { ok: false, error: `"${id}" is not a valid scenario id` };
    if (entries.some((e) => e.id === id)) return { ok: false, error: `"${id}" is listed twice` };
    entries.push({ id, weight: Number(w) });
  }
  if (!entries.length) return { ok: false, error: "HIRECUTE_SCENARIOS lists no scenario" };
  const sum = entries.reduce((s, e) => s + e.weight, 0);
  if (sum !== 100) return { ok: false, error: `weights sum to ${sum}, not 100` };
  return { ok: true, entries };
}

/** The query parameter name, validated. */
export function scenarioParam(env) {
  const p = env.HIRECUTE_SCENARIO_PARAM?.trim();
  return p && /^[A-Za-z0-9_-]{1,32}$/.test(p) ? p : null;
}

/**
 * Pick the scenario for a visitor. Pure: randomness is injected.
 *
 *   1. ?<param>=<id> naming an enabled scenario (any weight, 0 included) wins.
 *   2. Otherwise a cookie naming an enabled scenario keeps the visitor where
 *      they were (sticky).
 *   3. Otherwise a weighted draw over the scenarios with weight > 0.
 * The caller writes the result back to the cookie every time.
 *
 * @param {{value?: string|null, cookie?: string|null, entries: Array<{id: string, weight: number}>, random?: () => number}} opts
 * @returns {{id: string, reason: "param"|"sticky"|"split"|"param-unknown"|"sticky-disabled"}}
 */
export function resolveScenario({ value, cookie, entries, random = Math.random }) {
  const enabled = new Set(entries.map((e) => e.id));
  let fallbackReason = "split";
  if (value) {
    if (enabled.has(value)) return { id: value, reason: "param" };
    fallbackReason = "param-unknown";
  } else if (cookie) {
    if (enabled.has(cookie)) return { id: cookie, reason: "sticky" };
    fallbackReason = "sticky-disabled";
  }
  return { id: drawWeighted(entries, random), reason: fallbackReason };
}

function drawWeighted(entries, random) {
  const pool = entries.filter((e) => e.weight > 0);
  let x = random() * 100;
  for (const e of pool) {
    if (x < e.weight) return e.id;
    x -= e.weight;
  }
  return pool[pool.length - 1].id; // float edge at exactly 100
}

// ── Files ─────────────────────────────────────────────────────────────────────

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function loadScenario(codeRoot, id) {
  if (!ID.test(id)) throw new Error(`invalid scenario id "${id}"`);
  return readJson(path.join(scenariosDir(codeRoot), `${id}.json`));
}

export async function loadStepManifest(codeRoot, ref) {
  if (!REF.test(ref)) throw new Error(`invalid step reference "${ref}"`);
  return readJson(path.join(stepsDir(codeRoot), `${ref}.json`));
}

/** Load a scenario and every manifest it names; throws on a missing or unparsable file. */
export async function loadScenarioBundle(codeRoot, id) {
  const scenario = await loadScenario(codeRoot, id);
  const manifests = {};
  for (const node of scenario.pipeline ?? []) {
    if (typeof node?.step === "string" && !manifests[node.step]) {
      manifests[node.step] = await loadStepManifest(codeRoot, node.step);
    }
  }
  return { scenario, manifests };
}

// ── Validation ────────────────────────────────────────────────────────────────

const optional = (key) => key.endsWith("?");
const bare = (key) => (optional(key) ? key.slice(0, -1) : key);

/**
 * Everything that can be checked without running a step. Returns a list of
 * human-readable errors; empty means valid.
 */
export function validateScenario(id, scenario, manifests) {
  const errors = [];
  const err = (m) => errors.push(`${id}: ${m}`);

  if (scenario?.id !== id) err(`file declares id "${scenario?.id}"`);
  if (!Number.isInteger(scenario?.version) || scenario.version < 1) err("version must be a positive integer");
  const pipeline = Array.isArray(scenario?.pipeline) ? scenario.pipeline : [];
  if (!pipeline.length) err("pipeline is empty");

  const refs = pipeline.map((n) => n?.step);
  const seen = new Set();
  for (const ref of refs) {
    if (typeof ref !== "string" || !REF.test(ref)) err(`"${ref}" is not a step reference (id@version)`);
    else if (seen.has(ref)) err(`step ${ref} appears twice`);
    seen.add(ref);
  }
  for (const node of pipeline) {
    for (const dep of node?.after ?? []) {
      if (!seen.has(dep)) err(`${node.step} runs after unknown step ${dep}`);
      if (dep === node.step) err(`${node.step} runs after itself`);
    }
  }
  if (errors.length) return errors;

  const order = topoOrder(scenario);
  if (!order) return [...errors, `${id}: steps form a cycle`];

  // Manifests: shape, and that their declared ref matches the file.
  const slots = new Map();
  for (const ref of refs) {
    const m = manifests[ref];
    if (!m) {
      err(`no manifest for ${ref}`);
      continue;
    }
    if (`${m.id}@${m.version}` !== ref) err(`manifest ${ref} declares ${m.id}@${m.version}`);
    if (!STAGE_SLOTS.includes(m.stage)) err(`${ref} reports into unknown stage "${m.stage}"`);
    else if (slots.has(m.stage)) err(`${ref} and ${slots.get(m.stage)} both report into stage "${m.stage}"`);
    else slots.set(m.stage, ref);
    if (typeof m.module !== "string" || typeof m.export !== "string") err(`${ref} needs module and export`);
    for (const svc of Object.values(m.services ?? {})) {
      if (!NAMED_SERVICES.includes(svc)) err(`${ref} requests unknown service "${svc}"`);
    }
    for (const req of m.requires ?? []) {
      if (!REQUIREMENTS.includes(req)) err(`${ref} requires unknown component "${req}"`);
    }
  }
  if (errors.length) return errors;

  // Data flow: every required read is written by a step that is guaranteed to
  // have run first — an ancestor through `after`, not just earlier in the file.
  const ancestors = ancestorsOf(scenario);
  for (const ref of order) {
    const m = manifests[ref];
    for (const [arg, key] of Object.entries(m.reads ?? {})) {
      if (optional(key) || arg in (m.defaults ?? {})) continue;
      const writer = [...ancestors.get(ref)].find((a) =>
        Object.values(manifests[a].writes ?? {}).map(bare).includes(key),
      );
      if (!writer) err(`${ref} reads "${key}" (${arg}) but no step it runs after writes it`);
    }
  }

  if (!slots.has(scenario.resultStage)) err(`resultStage "${scenario.resultStage}" is not a stage any step reports into`);
  return errors;
}

/** Kahn's algorithm, ties broken by file order. Null on a cycle. */
export function topoOrder(scenario) {
  const nodes = scenario.pipeline.map((n) => n.step);
  const deps = new Map(scenario.pipeline.map((n) => [n.step, new Set(n.after ?? [])]));
  const order = [];
  const done = new Set();
  while (order.length < nodes.length) {
    const next = nodes.find((n) => !done.has(n) && [...deps.get(n)].every((d) => done.has(d)));
    if (!next) return null;
    order.push(next);
    done.add(next);
  }
  return order;
}

function ancestorsOf(scenario) {
  const direct = new Map(scenario.pipeline.map((n) => [n.step, n.after ?? []]));
  const memo = new Map();
  const walk = (ref) => {
    if (memo.has(ref)) return memo.get(ref);
    const out = new Set();
    for (const d of direct.get(ref)) {
      out.add(d);
      for (const a of walk(d)) out.add(a);
    }
    memo.set(ref, out);
    return out;
  };
  for (const ref of direct.keys()) walk(ref);
  return memo;
}

/**
 * Validate the deployment: the env parses, and every enabled scenario loads
 * and is internally consistent. Used by preflight and by the server before it
 * hands a scenario to a run.
 *
 * @returns {Promise<{ok: boolean, param: string|null, entries: Array<{id: string, weight: number}>, errors: string[], scenarios: Record<string, {version: number, resultStage: string, steps: string[], requires: string[]}>}>}
 */
export async function checkDeploymentScenarios(codeRoot, env) {
  const errors = [];
  const param = scenarioParam(env);
  if (!param) errors.push("HIRECUTE_SCENARIO_PARAM is not set or not a plain name (letters, digits, - and _)");
  const parsed = parseScenariosEnv(env.HIRECUTE_SCENARIOS);
  if (!parsed.ok) errors.push(parsed.error);
  const entries = parsed.ok ? parsed.entries : [];
  const scenarios = {};
  for (const { id } of entries) {
    try {
      const { scenario, manifests } = await loadScenarioBundle(codeRoot, id);
      const errs = validateScenario(id, scenario, manifests);
      if (errs.length) errors.push(...errs);
      else {
        const requires = [...new Set(Object.values(manifests).flatMap((m) => m.requires ?? []))];
        scenarios[id] = { version: scenario.version, resultStage: scenario.resultStage, steps: topoOrder(scenario), requires };
      }
    } catch (e) {
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: errors.length === 0, param, entries, errors, scenarios };
}
