import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  checkDeploymentScenarios,
  loadScenarioBundle,
  parseScenariosEnv,
  resolveScenario,
  scenarioParam,
  stepsDir,
  topoOrder,
  validateScenario,
} from "../../src/lib/hirecute/scenarios.mjs";

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENV = { HIRECUTE_SCENARIO_PARAM: "t", HIRECUTE_SCENARIOS: "vacancy=50;recruiter=50" };

// ── env ──────────────────────────────────────────────────────────────────────

test("HIRECUTE_SCENARIOS parses id=weight pairs that sum to 100", () => {
  assert.deepEqual(parseScenariosEnv(" vacancy = 50 ; recruiter=50; "), {
    ok: true,
    entries: [{ id: "vacancy", weight: 50 }, { id: "recruiter", weight: 50 }],
  });
  assert.deepEqual(parseScenariosEnv("vacancy=100;new=0").entries.map((e) => e.weight), [100, 0]);
});

test("HIRECUTE_SCENARIOS rejects what would silently misroute traffic", () => {
  for (const [value, why] of [
    [undefined, /not set/],
    ["vacancy=60;recruiter=50", /sum to 110/],
    ["vacancy=50;vacancy=50", /twice/],
    ["vacancy:50;recruiter=50", /not id=weight/],
    ["Vacancy=100", /not a valid scenario id/],
    ["vacancy=-5;recruiter=105", /not id=weight/],
  ]) {
    const res = parseScenariosEnv(value);
    assert.equal(res.ok, false, String(value));
    assert.match(res.error, why, String(value));
  }
});

test("the query parameter name must be a plain token", () => {
  assert.equal(scenarioParam({ HIRECUTE_SCENARIO_PARAM: " t " }), "t");
  assert.equal(scenarioParam({}), null);
  assert.equal(scenarioParam({ HIRECUTE_SCENARIO_PARAM: "a b" }), null);
});

// ── resolveScenario ──────────────────────────────────────────────────────────

const entries = [
  { id: "vacancy", weight: 50 },
  { id: "recruiter", weight: 50 },
  { id: "beta", weight: 0 },
];

test("an enabled ?t= value wins over the cookie, including a link-only (weight 0) scenario", () => {
  assert.deepEqual(resolveScenario({ value: "recruiter", cookie: "vacancy", entries }), { id: "recruiter", reason: "param" });
  assert.deepEqual(resolveScenario({ value: "beta", cookie: null, entries }), { id: "beta", reason: "param" });
});

test("without a value, an enabled cookie is sticky", () => {
  assert.deepEqual(resolveScenario({ value: null, cookie: "vacancy", entries, random: () => 0.99 }), { id: "vacancy", reason: "sticky" });
});

test("an unknown value, a disabled cookie and a first visit all go to the split", () => {
  assert.deepEqual(resolveScenario({ value: "nope", cookie: "vacancy", entries, random: () => 0.99 }), { id: "recruiter", reason: "param-unknown" });
  assert.deepEqual(resolveScenario({ value: null, cookie: "retired", entries, random: () => 0 }), { id: "vacancy", reason: "sticky-disabled" });
  assert.deepEqual(resolveScenario({ value: null, cookie: null, entries, random: () => 0.5 }), { id: "recruiter", reason: "split" });
});

test("the split follows the weights and never picks a weight-0 scenario", () => {
  const counts = { vacancy: 0, recruiter: 0, beta: 0 };
  for (let i = 0; i < 1000; i++) counts[resolveScenario({ entries, random: () => i / 1000 }).id]++;
  assert.deepEqual(counts, { vacancy: 500, recruiter: 500, beta: 0 });
  const skewed = [{ id: "a", weight: 20 }, { id: "b", weight: 80 }];
  const a = Array.from({ length: 100 }, (_, i) => resolveScenario({ entries: skewed, random: () => i / 100 }).id).filter((x) => x === "a").length;
  assert.equal(a, 20);
});

// ── validation ───────────────────────────────────────────────────────────────

const manifest = (id, stage, reads = {}, writes = {}, extra = {}) => ({
  id, version: 1, stage, module: `./${id}.mjs`, export: "run", reads, writes, ...extra,
});
const flowFor = (stages) => ({
  stages,
  steps: stages.map((st) => ({ stages: [st], title: st })),
  screens: Object.fromEntries(stages.map((st) => [st, "resume-read"])),
  packing: [],
  absorbed: [],
});
const scenario = (pipeline, extra = {}) => ({ id: "s", version: 1, resultStage: "match", pipeline, ...extra });

test("a well-formed linear scenario validates", () => {
  const manifests = {
    "a@1": manifest("a", "refine", {}, { out: "x" }),
    "b@1": manifest("b", "match", { in: "x" }),
  };
  const s = scenario([{ step: "a@1" }, { step: "b@1", after: ["a@1"] }], { flow: flowFor(["refine", "match"]) });
  assert.deepEqual(validateScenario("s", s, manifests), []);
});

test("validation catches cycles, unknown deps and duplicate stage slots", () => {
  const m = { "a@1": manifest("a", "refine"), "b@1": manifest("b", "match") };
  assert.match(validateScenario("s", scenario([{ step: "a@1", after: ["b@1"] }, { step: "b@1", after: ["a@1"] }]), m).join(), /cycle/);
  assert.match(validateScenario("s", scenario([{ step: "a@1", after: ["z@1"] }]), m).join(), /unknown step z@1/);
  const dup = { "a@1": manifest("a", "match"), "b@1": manifest("b", "match") };
  assert.match(validateScenario("s", scenario([{ step: "a@1" }, { step: "b@1" }]), dup).join(), /both report into stage "match"/);
});

test("a read must be written by an ANCESTOR, not merely by an earlier line", () => {
  const manifests = {
    "a@1": manifest("a", "refine", {}, { out: "x" }),
    "b@1": manifest("b", "match", { in: "x" }),
  };
  // b is listed after a but does not declare `after`: nothing guarantees a ran first.
  const errs = validateScenario("s", scenario([{ step: "a@1" }, { step: "b@1" }]), manifests);
  assert.match(errs.join(), /b@1 reads "x" \(in\) but no step it runs after writes it/);
});

test("optional reads and defaulted reads need no writer", () => {
  const manifests = {
    "a@1": manifest("a", "refine", { p: "user.preferences?", q: "y" }, {}, { defaults: { q: 1 } }),
  };
  assert.deepEqual(validateScenario("s", scenario([{ step: "a@1" }], { resultStage: "refine", flow: flowFor(["refine"]) }), manifests), []);
});

test("resultStage must be a stage the scenario reports into", () => {
  const errs = validateScenario("s", scenario([{ step: "a@1" }], { resultStage: "prepare" }), { "a@1": manifest("a", "refine") });
  assert.match(errs.join(), /resultStage "prepare"/);
});

test("topoOrder keeps file order among ready steps", () => {
  const s = scenario([{ step: "c@1", after: ["a@1"] }, { step: "a@1" }, { step: "b@1" }]);
  assert.deepEqual(topoOrder(s), ["a@1", "c@1", "b@1"]); // c is first in the file once a is done
});

// ── the shipped scenarios ────────────────────────────────────────────────────

test("the shipped scenarios validate and run the steps each version ran", async () => {
  const d = await checkDeploymentScenarios(CODE_ROOT, ENV);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.scenarios.vacancy.steps, ["refine-classic@1", "explore-classic@2", "match-classic@2", "prepare-classic@1"]);
  assert.equal(d.scenarios.vacancy.resultStage, "prepare");
  assert.deepEqual(d.scenarios.vacancy.requires, ["chromium"]);
  assert.deepEqual(d.scenarios.recruiter.steps, ["refine-sections@2", "explore@1", "match@1", "improve@1"]);
  assert.equal(d.scenarios.recruiter.resultStage, "improve");
  assert.deepEqual(d.scenarios.recruiter.requires, []);
});

test("every shipped step manifest points at a module that exports its function", async () => {
  for (const id of ["vacancy", "recruiter"]) {
    const { manifests } = await loadScenarioBundle(CODE_ROOT, id);
    for (const [ref, m] of Object.entries(manifests)) {
      const mod = await import(pathToFileURL(path.resolve(stepsDir(CODE_ROOT), m.module)).href);
      assert.equal(typeof mod[m.export], "function", `${ref}: ${m.module}#${m.export}`);
    }
  }
});

test("a scenario named in the env but missing on disk is a deployment error", async () => {
  const d = await checkDeploymentScenarios(CODE_ROOT, { ...ENV, HIRECUTE_SCENARIOS: "vacancy=50;ghost=50" });
  assert.equal(d.ok, false);
  assert.match(d.errors.join(), /ghost/);
});
