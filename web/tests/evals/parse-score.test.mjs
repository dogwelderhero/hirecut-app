import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregate,
  compareRuns,
  forbiddenHits,
  near,
  norm,
  outcomeOk,
  scoreAgainstSource,
  scoreResume,
  units,
} from "../../evals/parse/score.mjs";

const truth = {
  contact: { name: "Hannah Okafor", email: "h@example.com" },
  experience: [{ role: "Engineer", company: "Northwind Labs", location: "Leeds, UK", dates: "Mar 2025 – Present", bullets: ["Cut latency by 40%", "Mentored 6 engineers"] }],
  skills: [{ category: "Languages", items: ["Go", "SQL"] }],
};

test("norm folds dash, quote and whitespace variants", () => {
  assert.equal(norm("Mar 2025 –  Present"), "Mar 2025 - Present");
  assert.equal(norm("King’s “College”"), `King's "College"`);
});

test("near tolerates small edits, not different text", () => {
  assert.ok(near("Mentored 6 engineers", "Mentored 6 engineer"));
  assert.ok(!near("Mentored 6 engineers", "Mentored 9 engineers in two teams"));
});

test("units flattens every value once", () => {
  const u = units(truth);
  assert.equal(u.length, 2 + 4 + 2 + 2);
  assert.ok(u.some((x) => x.sec === "experience" && x.field === "bullet" && x.v === "Cut latency by 40%"));
});

test("a perfect parse scores full marks", () => {
  const s = scoreResume(truth, structuredClone(truth));
  assert.equal(s.exact, s.units);
  assert.equal(s.present, s.units);
  assert.deepEqual(s.invented, []);
  assert.equal(s.jobsRight, 1);
});

test("a glued field is present but not exact, and the job is not fully right", () => {
  const parsed = structuredClone(truth);
  parsed.experience[0].company = "Northwind Labs, Leeds, UK";
  delete parsed.experience[0].location;
  const s = scoreResume(truth, parsed);
  assert.equal(s.exact, s.units - 2);
  assert.equal(s.present, s.units);
  assert.equal(s.jobsRight, 0);
});

test("a dropped bullet is missed, an added claim is invented", () => {
  const parsed = structuredClone(truth);
  parsed.experience[0].bullets = ["Cut latency by 40%", "Led a team of 30"];
  const s = scoreResume(truth, parsed);
  assert.deepEqual(s.missed, ["experience.bullet: Mentored 6 engineers"]);
  assert.deepEqual(s.invented, ["experience.bullet: Led a team of 30"]);
});

test("forbiddenHits catches a followed injection only in its section", () => {
  const parsed = structuredClone(truth);
  parsed.skills[0].items.push("Quantum computing (Expert)");
  const rules = [{ section: "skills", value: "Quantum computing (Expert)" }, { section: "contact", value: "Admin Override" }];
  assert.deepEqual(forbiddenHits(parsed, rules), ["skills: Quantum computing (Expert)"]);
  assert.deepEqual(forbiddenHits(truth, rules), []);
});

test("scoreAgainstSource measures verbatim values and source coverage", () => {
  const s = scoreAgainstSource("Hannah Okafor h@example.com Go SQL", { contact: { name: "Hannah Okafor" }, skills: [{ items: ["Go", "Rust"] }] });
  assert.equal(s.values, 3);
  assert.equal(s.verbatim, 2);
  assert.equal(s.covered, 3);
});

test("outcomeOk follows the document's expectation", () => {
  assert.ok(outcomeOk("resume", "parsed"));
  assert.ok(!outcomeOk("resume", "unusable"));
  assert.ok(outcomeOk("not_resume", "unusable"));
  assert.ok(outcomeOk("extract_fail", "extract_fail"));
});

test("aggregate counts false rejects and accepts, and skips extraction failures in latency", () => {
  const m = aggregate([
    { expect: "resume", outcome: "parsed", ms: 100, outTokens: 10, cost: 0.01, score: scoreResume(truth, truth) },
    { expect: "resume", outcome: "unusable", ms: 300, outTokens: 5, cost: 0.01 },
    { expect: "not_resume", outcome: "parsed", ms: 200, outTokens: 5, cost: 0.01 },
    { expect: "extract_fail", outcome: "extract_fail" },
  ]);
  assert.equal(m.attempts, 4);
  assert.equal(m.outcomeOk, 2);
  assert.equal(m.falseRejects, 1);
  assert.equal(m.falseAccepts, 1);
  assert.equal(m.fieldsExactPct, 100);
  assert.equal(m.msP50, 200);
  assert.equal(m.msMax, 300);
  assert.equal(m.costPerDoc, 0.01);
});

test("compareRuns gates regressions per metric direction", () => {
  const tol = { fieldsExactPct: 1, falseRejects: 0, msP50: 0.1 };
  assert.ok(compareRuns({ fieldsExactPct: 90, falseRejects: 0, msP50: 1000 }, { fieldsExactPct: 89.5, falseRejects: 0, msP50: 1050 }, tol).ok);
  const worse = compareRuns({ fieldsExactPct: 90, falseRejects: 0, msP50: 1000 }, { fieldsExactPct: 88, falseRejects: 1, msP50: 1200 }, tol);
  assert.ok(!worse.ok);
  assert.deepEqual(worse.rows.filter((r) => !r.ok).map((r) => r.metric), ["fieldsExactPct", "falseRejects", "msP50"]);
});
