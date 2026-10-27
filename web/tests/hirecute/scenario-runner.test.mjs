import { test } from "node:test";
import assert from "node:assert/strict";

import { StepContractError, executeScenario } from "../../workers/scenario-runner.mjs";

/**
 * Steps are fakes served by an injected importer, so these tests exercise the
 * runner's contract handling, not any real stage.
 */
function harness(modules, { context } = {}) {
  const diags = [];
  const calls = [];
  const importModule = async (url) => {
    const name = url.split("/").pop().replace(/\.mjs$/, "");
    const mod = modules[name];
    if (!mod) throw new Error(`no fake module ${name}`);
    return { run: async (ctx) => { calls.push({ name, ctx }); return mod(ctx); } };
  };
  return {
    diags,
    calls,
    opts: {
      stepsRoot: "/steps",
      builtins: { emit: () => {}, diag: (e) => diags.push(e), runDir: "/run", codeRoot: "/code" },
      services: { utilityEnv: () => ({ PATH: "/bin" }) },
      importModule,
      ...(context ? { context } : {}),
    },
  };
}

const m = (id, extra = {}) => ({ id, version: 1, stage: "refine", module: `./${id}.mjs`, export: "run", reads: {}, writes: {}, ...extra });

test("steps run in dependency order and pass data only through the context", async () => {
  const h = harness({
    a: () => ({ ok: true, seed: { q: "pm" }, extra: "not declared" }),
    b: (ctx) => ({ ok: true, jobs: [ctx.searchSeed.q] }),
  });
  const res = await executeScenario({
    ...h.opts,
    scenario: { resultStage: "explore", pipeline: [{ step: "b@1", after: ["a@1"] }, { step: "a@1" }] },
    manifests: {
      "a@1": m("a", { writes: { seed: "search.seed" } }),
      "b@1": m("b", { stage: "explore", reads: { searchSeed: "search.seed" }, writes: { jobs: "jobs.shortlist" } }),
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.resultStage, "explore");
  assert.deepEqual(h.calls.map((c) => c.name), ["a", "b"]);
  assert.deepEqual(res.context.get("jobs.shortlist"), ["pm"]);
  assert.equal(res.context.has("extra"), false, "undeclared return fields do not leak into the context");
  assert.equal("extra" in h.calls[1].ctx, false);
});

test("built-ins, named services and defaults reach the step; optional reads may be absent", async () => {
  const h = harness({ a: () => ({ ok: true }) });
  await executeScenario({
    ...h.opts,
    scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
    manifests: {
      "a@1": m("a", { services: { env: "utilityEnv" }, defaults: { preferences: {} }, reads: { preferences: "user.preferences?", x: "x?" } }),
    },
  });
  const { ctx } = h.calls[0];
  assert.equal(ctx.runDir, "/run");
  assert.equal(ctx.codeRoot, "/code");
  assert.equal(typeof ctx.emit, "function");
  assert.deepEqual(ctx.env, { PATH: "/bin" });
  assert.deepEqual(ctx.preferences, {});
  assert.equal("x" in ctx, false);
});

test("a context key overrides a default", async () => {
  const h = harness({ a: () => ({ ok: true }) });
  await executeScenario({
    ...h.opts,
    context: new Map([["user.preferences", { roles: ["pm"] }]]),
    scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
    manifests: { "a@1": m("a", { defaults: { preferences: {} }, reads: { preferences: "user.preferences?" } }) },
  });
  assert.deepEqual(h.calls[0].ctx.preferences, { roles: ["pm"] });
});

test("a step returning ok:false stops the scenario without throwing", async () => {
  const h = harness({ a: () => ({ ok: false }), b: () => ({ ok: true }) });
  const res = await executeScenario({
    ...h.opts,
    scenario: { resultStage: "match", pipeline: [{ step: "a@1" }, { step: "b@1", after: ["a@1"] }] },
    manifests: { "a@1": m("a"), "b@1": m("b", { stage: "match" }) },
  });
  assert.deepEqual([res.ok, res.step], [false, "a@1"]);
  assert.deepEqual(h.calls.map((c) => c.name), ["a"]);
  assert.deepEqual(h.diags.at(-1).step.phase, "stopped");
});

test("a missing required input is a contract error, before the step runs", async () => {
  const h = harness({ a: () => ({ ok: true }) });
  await assert.rejects(
    executeScenario({
      ...h.opts,
      scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
      manifests: { "a@1": m("a", { reads: { jobs: "jobs.shortlist" } }) },
    }),
    (err) => err instanceof StepContractError && /input "jobs.shortlist"/.test(err.message),
  );
  assert.equal(h.calls.length, 0);
});

test("ok without a declared output is a contract error; an optional output may be absent", async () => {
  const h = harness({ a: () => ({ ok: true, b: 1 }) });
  await assert.rejects(
    executeScenario({
      ...h.opts,
      scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
      manifests: { "a@1": m("a", { writes: { a: "k.a" } }) },
    }),
    /returned ok without "a"/,
  );
  const res = await executeScenario({
    ...h.opts,
    scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
    manifests: { "a@1": m("a", { writes: { a: "k.a?", b: "k.b" } }) },
  });
  assert.deepEqual([res.context.has("k.a"), res.context.get("k.b")], [false, 1]);
});

test("a null output is a value, not a missing one", async () => {
  const h = harness({ a: () => ({ ok: true, hash: null }) });
  const res = await executeScenario({
    ...h.opts,
    scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
    manifests: { "a@1": m("a", { writes: { hash: "resume.hash" } }) },
  });
  assert.equal(res.context.get("resume.hash"), null);
});

test("an absent export or service is a contract error", async () => {
  const h = harness({ a: () => ({ ok: true }) });
  await assert.rejects(
    executeScenario({ ...h.opts, scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] }, manifests: { "a@1": m("a", { export: "nope" }) } }),
    /has no export nope/,
  );
  await assert.rejects(
    executeScenario({ ...h.opts, scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] }, manifests: { "a@1": m("a", { services: { s: "billing" } }) } }),
    /service billing is not provided/,
  );
});

test("each step is timed in diagnostics", async () => {
  let t = 0;
  const h = harness({ a: () => { t += 40; return { ok: true }; } });
  await executeScenario({
    ...h.opts,
    now: () => t,
    scenario: { resultStage: "refine", pipeline: [{ step: "a@1" }] },
    manifests: { "a@1": m("a") },
  });
  assert.deepEqual(h.diags.map((d) => d.step), [{ ref: "a@1", phase: "start" }, { ref: "a@1", phase: "done", ms: 40 }]);
});
