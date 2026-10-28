#!/usr/bin/env node
/**
 * The "no worse" gate: compares the latest saved run of two setups on the same
 * corpus version and exits 1 if the candidate regresses beyond the tolerances
 * in setups.json.
 *
 *   node evals/parse/compare.mjs --base current --candidate planned
 *   node evals/parse/compare.mjs --history          (every saved run, oldest first)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { compareRuns } from "./score.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: { base: { type: "string" }, candidate: { type: "string" }, history: { type: "boolean" }, results: { type: "string" } },
});
const resultsDir = path.resolve(args.results ?? path.join(here, "results"));
const runs = readFileSync(path.join(resultsDir, "history.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const SHOW = ["outcomeOk", "falseRejects", "falseAccepts", "fieldsExactPct", "contentPresentPct", "jobsRightPct", "invented", "injectionFollowed", "msP50", "msP90", "costPerDoc", "fallbacks", "corrections"];

if (args.history) {
  console.log(["run", "setup", "commit", "corpus", "models", ...SHOW].join(" | "));
  for (const r of runs) console.log([r.runId, r.setup, r.commit, r.corpusHash, r.models.join("+"), ...SHOW.map((m) => r.metrics[m])].join(" | "));
  process.exit(0);
}

if (!args.base || !args.candidate) {
  console.error("Usage: compare.mjs --base <setup> --candidate <setup> | --history");
  process.exit(2);
}
const latest = (setup, corpusHash) => [...runs].reverse().find((r) => r.setup === setup && (!corpusHash || r.corpusHash === corpusHash));
const candidate = latest(args.candidate);
const base = candidate && latest(args.base, candidate.corpusHash);
if (!candidate || !base) {
  console.error(`Need a saved run of both "${args.base}" and "${args.candidate}" on the same corpus version.`);
  process.exit(2);
}

const { tolerance } = JSON.parse(readFileSync(path.join(here, "setups.json"), "utf8")).gate;
const result = compareRuns(base.metrics, candidate.metrics, Object.fromEntries(Object.entries(tolerance).filter(([k]) => !k.startsWith("_"))));
console.log(`base ${base.runId} (${base.commit})  vs  candidate ${candidate.runId} (${candidate.commit}), corpus ${base.corpusHash}`);
console.log("metric | base | candidate | ok");
for (const r of result.rows) console.log(`${r.metric} | ${r.base} | ${r.candidate} | ${r.ok ? "ok" : "WORSE"}${r.note ? ` (${r.note})` : ""}`);
for (const m of ["msMax", "outTokensP50", "costPerDoc", "fallbacks", "corrections"]) console.log(`${m} | ${base.metrics[m]} | ${candidate.metrics[m]} | (not gated)`);
console.log(result.ok ? "\nNo regression." : "\nREGRESSION: the candidate is worse than the base.");
process.exit(result.ok ? 0 : 1);
