import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publishSections } from "../../workers/stages/refine-classic.mjs";

const manifest = async (id) => JSON.parse(await readFile(new URL(`../../workers/steps/${id}.json`, import.meta.url), "utf8"));

test("refine-classic@2 reads and writes exactly what refine-classic@1 does", async () => {
  const [v1, v2] = await Promise.all([manifest("refine-classic@1"), manifest("refine-classic@2")]);
  assert.deepEqual([v2.stage, v2.reads, v2.writes, v2.services, v2.requires], [v1.stage, v1.reads, v1.writes, v1.services, v1.requires]);
});

function ctx() {
  const emitted = [];
  const diags = [];
  return { emitted, diags, emit: (type, payload, stage) => emitted.push({ type, payload, stage }), diag: (e) => diags.push(e) };
}

test("the sections read alongside the refine are published for the screen", async () => {
  const c = ctx();
  await publishSections(c, async () => ({ resume: { name: "Alex" } }));
  assert.deepEqual(c.emitted, [{ type: "resume.parsed", payload: { resume: { name: "Alex" } }, stage: "refine" }]);
});

test("a read that fails or throws publishes nothing and never fails the stage", async () => {
  const quiet = ctx();
  await publishSections(quiet, async () => null);
  assert.deepEqual(quiet.emitted, []);
  const broken = ctx();
  await publishSections(broken, async () => {
    throw new Error("model down");
  });
  assert.deepEqual(broken.emitted, []);
  assert.deepEqual(broken.diags, [{ displayParseError: "model down" }]);
});
