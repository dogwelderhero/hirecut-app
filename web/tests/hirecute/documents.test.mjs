import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { checkFacts, factFlags } = await import(
  "../../src/lib/hirecute/documents.mjs"
);

/**
 * The fact check.
 *
 * The earlier wiring read `findings`/`issues` from `verify-cv-facts.mjs`,
 * fields it never emits, so every run reported zero findings. These tests pin
 * the real report shape end to end.
 */

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const SOURCE =
  "Senior Engineer, Acme Corp, 2019-2023. Cut infrastructure cost 30%. " +
  "Led a team of 5 engineers using Python.\n• Built the billing service";

test("factFlags maps the checker's real fields and de-duplicates", () => {
  const flags = factFlags({
    verdict: "block",
    invented: ["60%", "60%"],
    unsupportedFacts: [{ kind: "employer", value: "Google" }],
    forbidden: ["rockstar"],
    warnings: ["synergy"],
  });
  assert.deepEqual(flags, [
    { kind: "metric", claim: "60%" },
    { kind: "employer", claim: "Google" },
    { kind: "phrase", claim: "rockstar" },
  ]);
  assert.deepEqual(factFlags({ verdict: "pass", invented: [], unsupportedFacts: [], forbidden: [] }), []);
});

test("checkFacts runs in-process and flags an inflated metric", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "hc-facts-"));
  const sourcePath = path.join(runDir, "source-facts.md");
  await writeFile(sourcePath, SOURCE, "utf8");

  const clean = await checkFacts({ codeRoot: CODE_ROOT, runDir, sourcePath, text: "Cut infrastructure cost 30%." });
  assert.equal(clean.ran, true);
  assert.deepEqual(clean.flags, []);

  const inflated = await checkFacts({ codeRoot: CODE_ROOT, runDir, sourcePath, text: "Cut infrastructure cost 60%." });
  assert.equal(inflated.ran, true);
  assert.equal(inflated.verdict, "block");
  assert.ok(inflated.flags.some((f) => f.kind === "metric" && f.claim === "60%"));
});

test("checkFacts reports ran:false instead of a silent pass when the checker is missing", async () => {
  const runDir = await mkdtemp(path.join(tmpdir(), "hc-facts-"));
  const result = await checkFacts({
    codeRoot: runDir, // no verify-cv-facts.mjs here
    runDir,
    sourcePath: path.join(runDir, "nope.md"),
    text: "Cut cost 60%.",
  });
  assert.equal(result.ran, false);
  assert.deepEqual(result.flags, []);
});
