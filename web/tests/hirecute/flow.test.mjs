import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SCREEN_IDS, nextStageOf, screenOf, stepNumberOf, validateFlow } from "../../src/lib/hirecute/flow.mjs";
import { canReuseRun, sourceHash } from "../../src/lib/hirecute/run-dedupe.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const scenario = async (id) => JSON.parse(await readFile(path.join(WEB, "scenarios", `${id}.json`), "utf8"));

const recruiterLike = () => ({
  stages: ["refine", "explore", "match", "improve"],
  steps: [
    { stages: ["refine"], title: "Read" },
    { stages: ["explore", "match"], title: "Find" },
    { stages: ["improve"], title: "Improve" },
    { stages: [], title: "Recruiter", local: true },
  ],
  screens: { refine: "resume-read", explore: "jobs-gaps", match: "jobs-gaps", improve: "improve" },
  packing: ["refine", "match"],
  absorbed: ["explore"],
});
const PIPE = ["refine", "explore", "match", "improve"];

// ── flow helpers ─────────────────────────────────────────────────────────────

test("a step can span stages; numbers are 1-based; a local step has no stage", () => {
  const f = recruiterLike();
  assert.deepEqual(["refine", "explore", "match", "improve"].map((s) => stepNumberOf(f, s)), [1, 2, 2, 3]);
  assert.equal(stepNumberOf(f, "prepare"), null);
});

test("screens: by stage, and the first stage's before anything is visible", () => {
  const f = recruiterLike();
  assert.equal(screenOf(f, "explore"), "jobs-gaps");
  assert.equal(screenOf(f, null), "resume-read");
});

test("next stage follows the flow and ends at its last stage", () => {
  const f = recruiterLike();
  assert.equal(nextStageOf(f, "match"), "improve");
  assert.equal(nextStageOf(f, "improve"), null, "no 'Up next: Bulk Apply' after the recruiter journey's last stage");
});

// ── validation ───────────────────────────────────────────────────────────────

test("a well-formed flow validates", () => {
  assert.deepEqual(validateFlow("r", recruiterLike(), PIPE), []);
});

test("flow stages must be exactly the stages the pipeline runs", () => {
  const f = { ...recruiterLike(), stages: ["refine", "explore", "match"] };
  assert.match(validateFlow("r", f, PIPE).join(), /must be exactly the stages the pipeline reports into/);
});

test("every stage is in exactly one step; an empty step must say it is local", () => {
  const f = recruiterLike();
  f.steps = [{ stages: ["refine", "explore"], title: "A" }, { stages: ["explore", "match"], title: "B" }, { stages: [], title: "C" }];
  const all = validateFlow("r", f, PIPE).join("\n");
  assert.match(all, /stage "explore" is in steps 1 and 2/);
  assert.match(all, /stage "improve" is in no step/);
  assert.match(all, /step 3 has no stages; mark it "local"/);
});

test("every stage needs a known screen; packing/absorbed must be flow stages", () => {
  const f = recruiterLike();
  f.screens = { ...f.screens, improve: "carousel" };
  delete f.screens.refine;
  f.packing = ["prepare"];
  const all = validateFlow("r", f, PIPE).join("\n");
  assert.match(all, /stage "refine" has no screen/);
  assert.match(all, /unknown screen "carousel"/);
  assert.match(all, /packing lists "prepare"/);
});

// ── the shipped flows ────────────────────────────────────────────────────────

test("recruiter keeps product-v2's journey: 4 steps, explore absorbed into step 2, recruiter step local", async () => {
  const { flow } = await scenario("recruiter");
  assert.deepEqual(validateFlow("recruiter", flow, PIPE), []);
  assert.deepEqual(flow.steps.map((s) => s.title), ["Reading your resume", "Finding jobs & gaps", "Improving your resume", "Talk to a recruiter"]);
  assert.deepEqual([flow.packing, flow.absorbed], [["refine", "match"], ["explore"]]);
});

test("vacancy keeps production's journey: one step per stage, every result packs but bulk apply", async () => {
  const { flow } = await scenario("vacancy");
  assert.deepEqual(flow.shell, { credits: { bannerScreens: ["matches", "bulk-apply"], counterScreen: "bulk-apply" }, retryButton: true });
  assert.deepEqual(validateFlow("vacancy", flow, ["refine", "explore", "match", "prepare"]), []);
  assert.deepEqual(flow.steps.map((s) => s.title), ["Finetune Resume", "Explore Jobs", "Top matching jobs", "Bulk Apply"]);
  assert.deepEqual([flow.packing, flow.absorbed], [["refine", "explore", "match"], []]);
});

test("the React screen registry names exactly SCREEN_IDS and covers both shipped flows", async () => {
  const src = await readFile(path.join(WEB, "src", "components", "hirecute", "workspace", "screens.tsx"), "utf8");
  const reg = src.slice(src.indexOf("SCREENS"));
  const keys = [...reg.matchAll(/^\s{2}"?([a-z][a-z-]*)"?:\s/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...SCREEN_IDS].sort());
  for (const id of ["recruiter", "vacancy"]) {
    const { flow } = await scenario(id);
    for (const s of Object.values(flow.screens)) assert.ok(keys.includes(s), `${id}: ${s} is registered`);
  }
});

// ── duplicate submission ─────────────────────────────────────────────────────

const run = (status, hash = sourceHash("cv"), scenarioId = "recruiter") => ({ sourceHash: hash, snapshot: { status, scenario: { id: scenarioId } } });

test("the same resume again reuses a queued, running or finished run", () => {
  for (const status of ["queued", "running", "preparation_complete"]) {
    assert.equal(canReuseRun(run(status), { hash: sourceHash("cv"), scenarioId: "recruiter" }), true, status);
  }
});

test("a different file, another scenario, a cancelled or failed run, or no history: a new run", () => {
  const next = { hash: sourceHash("cv"), scenarioId: "recruiter" };
  assert.equal(canReuseRun(run("running", sourceHash("other")), next), false);
  assert.equal(canReuseRun(run("running", sourceHash("cv"), "vacancy"), next), false);
  for (const status of ["cancelled", "failed", "interrupted"]) assert.equal(canReuseRun(run(status), next), false, status);
  assert.equal(canReuseRun(null, next), false);
  assert.equal(canReuseRun({ snapshot: { status: "running" } }, next), false, "runs from before hashing are never matched");
});

test("the hash is of the content, not the file name", () => {
  assert.equal(sourceHash(Buffer.from("same bytes")), sourceHash("same bytes"));
  assert.notEqual(sourceHash("a"), sourceHash("b"));
});

test("shell features are validated against the flow's own screens", () => {
  const f = { ...recruiterLike(), shell: { credits: { bannerScreens: ["matches"], counterScreen: "bulk-apply" }, glitter: true } };
  const all = validateFlow("r", f, PIPE).join("\n");
  assert.match(all, /unknown shell feature "glitter"/);
  assert.match(all, /credits banner screen "matches" is not a screen of this flow/);
  assert.match(all, /credits counter screen "bulk-apply" is not a screen of this flow/);
});
