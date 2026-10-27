import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequirement, collectGaps, normalizeForMatch, verifyQuote } from "../../src/lib/hirecute/evidence.mjs";

const JD = "We need 5+ years of B2B payments experience.\nNice to have: Kubertenes and “event-driven” systems.";
const CV = "Senior Product Manager — Northwind Payments\nOwned checkout conversion across 12 markets";

test("a verbatim quote is kept, a paraphrase is not", () => {
  assert.equal(verifyQuote("5+ years of B2B payments experience", JD), "5+ years of B2B payments experience");
  assert.equal(verifyQuote("five years in payments", JD), null);
});

test("case, whitespace, curly quotes and dashes do not break a faithful copy", () => {
  assert.equal(verifyQuote('"event-driven" systems', JD), '"event-driven" systems');
  assert.equal(verifyQuote("Senior Product Manager - Northwind", CV), "Senior Product Manager - Northwind");
  assert.equal(normalizeForMatch("A  B—C"), "a b-c");
});

test("too-short quotes and model-added ellipses", () => {
  assert.equal(verifyQuote("B2B", JD), null);
  assert.equal(verifyQuote("…Owned checkout conversion…", CV), "Owned checkout conversion");
});

test("a requirement without a verifiable posting quote is dropped", () => {
  const r = checkRequirement({ requirement: "Payments", match: "strong", jobQuote: "made up line here", resumeQuote: "" }, { jobText: JD, resumeText: CV });
  assert.equal(r, null);
});

test("a strong match without a verbatim resume line becomes partial", () => {
  const r = checkRequirement(
    { requirement: "B2B payments", importance: "must_have", match: "strong", jobQuote: "5+ years of B2B payments experience", resumeQuote: "led B2B payments", explanation: "x" },
    { jobText: JD, resumeText: CV },
  );
  assert.equal(r.match, "partial");
  assert.equal(r.resumeQuote, null);
  assert.equal(r.jobQuote, "5+ years of B2B payments experience");
});

test("collectGaps merges the same requirement across jobs and ranks by how many ask", () => {
  const req = (requirement, match, jobQuote) => ({ requirement, match, importance: "must_have", jobQuote, resumeQuote: null });
  const gaps = collectGaps(
    [
      { jobId: "a", requirements: [req("SQL", "missing", "Strong SQL skills"), req("Payments", "strong", "payments")] },
      { jobId: "b", requirements: [req("sql", "partial", "Advanced SQL"), req("Kubernetes", "missing", "Kubernetes in production")] },
    ],
    { a: { id: "a", title: "PM", company: "A" }, b: { id: "b", title: "PM", company: "B" } },
  );
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].requirement, "SQL");
  assert.equal(gaps[0].match, "missing");
  assert.deepEqual(gaps[0].jobs.map((j) => j.jobId), ["a", "b"]);
  assert.equal(gaps[0].id, "gap-1");
});
