#!/usr/bin/env node
/**
 * Parse eval runner. Calls the product's own extraction and parse code
 * (extract.mjs, resume-parse.mjs) for every document in a corpus, under a named
 * setup from setups.json, and scores the result.
 *
 *   node evals/parse/run.mjs --setup current [--reps 2] [--only r01-classic,r13-long3]
 *   node evals/parse/run.mjs --setup current --corpus <private dir> --out <dir outside the repo>
 *
 * Needs the model endpoint in the environment, as the app does:
 * HIRECUTE_MODEL_API_BASE_URL and HIRECUTE_MODEL_API_KEY. Spends tokens.
 *
 * On the built-in corpus the metrics are saved in the repo (results/runs/*.json
 * and one line in results/history.jsonl) so they can be compared over time.
 * Raw model output goes to results/raw/, which git ignores.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { extractResumeText } from "../../src/lib/hirecute/extract.mjs";
import { normalizeResume } from "../../src/lib/hirecute/resume.mjs";
import { parseResume } from "../../src/lib/hirecute/resume-parse.mjs";
import { aggregate, forbiddenHits, scoreAgainstSource, scoreResume } from "./score.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({
  options: {
    setup: { type: "string", default: "current" },
    reps: { type: "string", default: "2" },
    corpus: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
    label: { type: "string" },
  },
});

const config = JSON.parse(readFileSync(path.join(here, "setups.json"), "utf8"));
const builtIn = !args.corpus;
const corpus = path.resolve(args.corpus ?? path.join(here, "corpus"));
if (!builtIn && !args.out) {
  console.error("A private corpus needs --out <dir outside the repo>: its results must not land in the public repository.");
  process.exit(2);
}
const resultsDir = builtIn ? path.join(here, "results") : path.resolve(args.out);
const reps = Number(args.reps);
const only = args.only?.split(",");

for (const k of ["HIRECUTE_MODEL_API_BASE_URL", "HIRECUTE_MODEL_API_KEY"]) {
  if (!process.env[k]) {
    console.error(`${k} is not set — the eval calls the model exactly as the app does.`);
    process.exit(2);
  }
}

/** A document: its file plus optional truth/meta. Files without meta are scored against their own text. */
function loadCorpus() {
  const files = readdirSync(corpus).filter((f) => /\.(pdf|docx)$/i.test(f)).sort();
  return files
    .map((file) => {
      const id = file.replace(/\.(pdf|docx)$/i, "");
      const read = (suffix) => (existsSync(path.join(corpus, `${id}.${suffix}`)) ? JSON.parse(readFileSync(path.join(corpus, `${id}.${suffix}`), "utf8")) : null);
      const meta = read("meta.json") ?? { id, expect: "resume", layout: "unknown", language: "unknown" };
      return { id, file, meta, truth: read("truth.json") };
    })
    .filter((d) => !only || only.includes(d.id));
}

function corpusHash() {
  const h = createHash("sha256");
  for (const f of readdirSync(corpus).sort()) {
    if (!/\.(pdf|docx|json)$/i.test(f)) continue;
    h.update(f);
    h.update(readFileSync(path.join(corpus, f)));
  }
  return h.digest("hex").slice(0, 12);
}

function git(...a) {
  try {
    return execFileSync("git", a, { cwd: here, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Apply a setup's env overlay; returns a restore function. */
function applySetup(setup) {
  const saved = {};
  for (const k of [...Object.keys(setup.env ?? {}), ...(setup.unset ?? [])]) saved[k] = process.env[k];
  for (const k of setup.unset ?? []) delete process.env[k];
  Object.assign(process.env, setup.env ?? {});
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

function cost(model, usage) {
  const p = config.prices[model];
  if (!p || !usage) return null;
  return ((usage.inputTokens ?? 0) * p[0] + (usage.outputTokens ?? 0) * p[1]) / 1e6;
}

async function attempt(doc, rawDir, rep) {
  const bytes = readFileSync(path.join(corpus, doc.file));
  const extracted = await extractResumeText(bytes);
  const base = { id: doc.id, rep, expect: doc.meta.expect ?? "resume", layout: doc.meta.layout, language: doc.meta.language };
  if (!extracted.ok) return { ...base, outcome: "extract_fail", reason: extracted.reason };

  const t0 = performance.now();
  const parsed = await parseResume(extracted.text);
  const ms = Math.round(performance.now() - t0);
  writeFileSync(path.join(rawDir, `${doc.id}.${rep}.json`), JSON.stringify({ parsed: { ...parsed, error: parsed.error ? String(parsed.error.detail ?? parsed.error.message ?? parsed.error) : undefined } }, null, 1));

  if (parsed.reason === "model") return { ...base, outcome: "model_error", ms, error: String(parsed.error?.code ?? parsed.error?.message ?? parsed.error) };
  const rec = {
    ...base,
    outcome: parsed.ok ? "parsed" : "unusable",
    ms,
    model: parsed.model,
    outTokens: parsed.usage?.outputTokens ?? null,
    inTokens: parsed.usage?.inputTokens ?? null,
    cost: cost(parsed.model, parsed.usage),
  };
  if (parsed.ok && doc.truth) rec.score = scoreResume(normalizeResume(doc.truth), parsed.resume);
  if (parsed.ok && !doc.truth) rec.sourceScore = scoreAgainstSource(extracted.text, parsed.resume);
  if (doc.meta.forbidden) rec.forbidden = forbiddenHits(parsed.resume, doc.meta.forbidden);
  return rec;
}

const docs = loadCorpus();
const hash = corpusHash();
const commit = git("rev-parse", "--short", "HEAD");
const dirty = Boolean(git("status", "--porcelain", "--", "../../src", "../../workers"));

for (const name of args.setup.split(",")) {
  const setup = config.setups[name];
  if (!setup) {
    console.error(`Unknown setup "${name}". Known: ${Object.keys(config.setups).join(", ")}`);
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.slice(0, 19).replace(/[:T]/g, "-")}_${name}${args.label ? `_${args.label}` : ""}`;
  const rawDir = path.join(resultsDir, "raw", runId);
  mkdirSync(rawDir, { recursive: true });

  const restore = applySetup(setup);
  const attempts = [];
  try {
    for (const doc of docs) {
      for (let rep = 1; rep <= reps; rep++) {
        const a = await attempt(doc, rawDir, rep);
        attempts.push(a);
        const s = a.score ? ` exact ${a.score.exact}/${a.score.units} invented ${a.score.invented.length}` : "";
        console.log(`${name} ${doc.id} #${rep} ${a.outcome}${a.ms != null ? ` ${a.ms}ms` : ""}${s}${a.forbidden?.length ? ` FOLLOWED INJECTION: ${a.forbidden.join("; ")}` : ""}`);
      }
    }
  } finally {
    restore();
  }

  const by = (key) =>
    Object.fromEntries([...new Set(attempts.map((a) => a[key]))].sort().map((v) => [v, aggregate(attempts.filter((a) => a[key] === v))]));
  const summary = {
    runId,
    startedAt,
    setup: name,
    setupDescription: setup.description,
    models: [...new Set(attempts.map((a) => a.model).filter(Boolean))],
    commit: commit ? `${commit}${dirty ? "-dirty" : ""}` : null,
    corpus: builtIn ? "built-in" : "external",
    corpusHash: hash,
    documents: docs.length,
    reps,
    metrics: aggregate(attempts),
    byLayout: by("layout"),
    byLanguage: by("language"),
    attempts: attempts.map(({ score, ...a }) => ({
      ...a,
      ...(score ? { units: score.units, exact: score.exact, present: score.present, jobs: score.jobs, jobsRight: score.jobsRight, missed: score.missed, invented: score.invented } : {}),
    })),
  };

  mkdirSync(path.join(resultsDir, "runs"), { recursive: true });
  writeFileSync(path.join(resultsDir, "runs", `${runId}.json`), JSON.stringify(summary, null, 2) + "\n");
  const { attempts: _a, byLayout: _l, byLanguage: _g, ...line } = summary;
  appendFileSync(path.join(resultsDir, "history.jsonl"), JSON.stringify(line) + "\n");

  console.log(`\n${name}: ${JSON.stringify(summary.metrics, null, 1)}`);
  console.log(`saved ${path.relative(process.cwd(), path.join(resultsDir, "runs", `${runId}.json`))}`);
}
