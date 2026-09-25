import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const CODE_ROOT = path.resolve(process.cwd(), "..");
const sha256 = (s) => `sha256:${createHash("sha256").update(s).digest("hex")}`;

const { normalizeHarvest, filterRelevant, toHirecuteJob } = await import(
  "../../src/lib/hirecute/jobs.mjs"
);
const { CURATED_BOARDS, enabledBoards, scopeDescription } = await import(
  "../../src/lib/hirecute/boards.mjs"
);

/**
 * Milestone 4 evidence.
 *
 * 02-screen-guide.md §5's acceptance checks: "The same provider/requisition URL
 * is deduplicated; different roles at the same company remain distinct. Missing
 * facts remain missing. Links resolve to actual posting/application URLs."
 *
 * Most of these assert what must NOT appear. A fabricated salary or a
 * "Just posted" derived from fetch time is indistinguishable from a real one to
 * a visitor, which is what makes it worth a test.
 */

const board = { name: "Monzo", provider: "greenhouse", careers_url: "https://job-boards.greenhouse.io/monzo" };

const posting = (over = {}) => ({
  title: "Senior Product Manager, Payments",
  url: "https://job-boards.greenhouse.io/monzo/jobs/5510001",
  company: "Monzo",
  location: "London, United Kingdom",
  postedAt: Date.parse("2026-09-22T00:00:00Z"),
  ...over,
});

// ── Dedup ─────────────────────────────────────────────────────────────────

test("the same requisition URL yields one card, not two", async () => {
  const raw = [
    { board, provider: "greenhouse", job: posting() },
    // Same posting, arriving again with tracking params and a trailing slash.
    {
      board,
      provider: "greenhouse",
      job: posting({ url: "https://job-boards.greenhouse.io/monzo/jobs/5510001/?utm_source=x" }),
    },
  ];
  const { jobs, duplicates } = await normalizeHarvest({ codeRoot: CODE_ROOT, raw, sha256 });
  assert.equal(jobs.length, 1, "canonical URL dedup must collapse these");
  assert.equal(duplicates, 1);
});

test("two different requisitions at ONE employer stay distinct", async () => {
  const raw = [
    { board, provider: "greenhouse", job: posting() },
    {
      board,
      provider: "greenhouse",
      job: posting({
        title: "Group Product Manager, Lending",
        url: "https://job-boards.greenhouse.io/monzo/jobs/5510044",
      }),
    },
  ];
  const { jobs, duplicates } = await normalizeHarvest({ codeRoot: CODE_ROOT, raw, sha256 });
  assert.equal(jobs.length, 2, "company name must not be part of the dedup key");
  assert.equal(duplicates, 0);
  assert.notEqual(jobs[0].id, jobs[1].id);
});

test("a posting with no URL or no title is dropped, not shown as a blank card", async () => {
  const raw = [
    { board, provider: "greenhouse", job: posting({ url: "" }) },
    { board, provider: "greenhouse", job: posting({ title: "  " }) },
  ];
  const { jobs } = await normalizeHarvest({ codeRoot: CODE_ROOT, raw, sha256 });
  assert.equal(jobs.length, 0);
});

// ── Missing facts stay missing ────────────────────────────────────────────

test("postedAt comes from the posting, and a missing date stays null", () => {
  const withDate = toHirecuteJob({
    providerId: "greenhouse",
    board,
    posting: posting(),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(withDate.postedAt, "2026-09-22T00:00:00.000Z");

  for (const bad of [null, undefined, "", "not-a-date", {}]) {
    const job = toHirecuteJob({
      providerId: "greenhouse",
      board,
      posting: posting({ postedAt: bad }),
      canonicalUrl: "u",
      hash: "h",
    });
    assert.equal(job.postedAt, null, `${JSON.stringify(bad)} must not become a date`);
  }
});

test("a missing date is never backfilled from fetch time", () => {
  const job = toHirecuteJob({
    providerId: "greenhouse",
    board,
    posting: posting({ postedAt: null }),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(job.postedAt, null);
  // fetchedAt exists and is now — but it is a DIFFERENT field, and the card
  // renders postedAt. "FoundAt is not PostedAt" (contracts.ts, Job).
  assert.ok(job.source.fetchedAt);
  assert.notEqual(job.source.fetchedAt, job.postedAt);
});

test("salary is never invented, and no funding/applicant/alumni fields exist", () => {
  const job = toHirecuteJob({
    providerId: "greenhouse",
    board,
    posting: posting(),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(job.salary, null, "a board listing publishes no salary — omit it");
  for (const forbidden of ["funding", "valuation", "alumni", "applicants", "applicantCount"]) {
    assert.equal(job[forbidden], undefined, `${forbidden} must not exist on a Job`);
  }
  assert.equal(job.employmentType, null);
  assert.equal(job.seniority, null);
  assert.equal(job.experienceYearsMin, null);
});

test("liveness is unverified, because we never opened the page", () => {
  const job = toHirecuteJob({
    providerId: "greenhouse",
    board,
    posting: posting(),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(job.source.liveStatus, "unverified");
  assert.equal(job.source.verifiedAt, null);
});

test("no recruiter address is invented", () => {
  const job = toHirecuteJob({
    providerId: "greenhouse",
    board,
    posting: posting(),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(job.recruiter.status, "unknown");
  assert.equal(job.recruiter.email, null);
  assert.equal(job.recruiter.displayName, "Hiring team · Monzo");
});

test("an unknown provider is labelled other_public_ats, not guessed", () => {
  const job = toHirecuteJob({
    providerId: "some-new-vendor",
    board,
    posting: posting(),
    canonicalUrl: "u",
    hash: "h",
  });
  assert.equal(job.source.provider, "other_public_ats");
});

// ── Relevance filter (deterministic, pre-model) ──────────────────────────

const jobsFor = (titles) =>
  titles.map((title, i) =>
    toHirecuteJob({
      providerId: "greenhouse",
      board,
      posting: posting({ title, url: `https://x/${i}` }),
      canonicalUrl: `https://x/${i}`,
      hash: "h",
    }),
  );

test("with no search seed, nothing is silently filtered away", () => {
  const jobs = jobsFor(["Chef", "Welder", "Product Manager"]);
  const out = filterRelevant(jobs, { targetRoles: [], locations: [] });
  assert.equal(out.length, 3, "an empty seed must not return an empty result");
});

test("relevance ranks on matched title terms", () => {
  const jobs = jobsFor(["Product Manager, Payments", "Engineering Manager", "Payments Analyst"]);
  const out = filterRelevant(jobs, { targetRoles: ["Product Manager, Payments"] });
  assert.equal(out[0].title, "Product Manager, Payments", "the best title match ranks first");
});

test("an unstated location is not treated as a mismatch", () => {
  const jobs = [
    toHirecuteJob({ providerId: "greenhouse", board, posting: posting({ location: null, url: "https://x/1" }), canonicalUrl: "https://x/1", hash: "h" }),
    toHirecuteJob({ providerId: "greenhouse", board, posting: posting({ location: "Berlin, Germany", url: "https://x/2" }), canonicalUrl: "https://x/2", hash: "h" }),
  ];
  const out = filterRelevant(jobs, { targetRoles: ["Product Manager"], locations: ["London"] });
  // Absence of evidence is not evidence of a mismatch.
  assert.equal(out.length, 1);
  assert.equal(out[0].location, null);
});

test("a remote role passes a location filter", () => {
  const jobs = [
    toHirecuteJob({ providerId: "greenhouse", board, posting: posting({ location: "Remote (US)", url: "https://x/1" }), canonicalUrl: "https://x/1", hash: "h" }),
  ];
  const out = filterRelevant(jobs, { targetRoles: ["Product Manager"], locations: ["London"] });
  assert.equal(out.length, 1);
  assert.equal(out[0].workStyle, "remote");
});

test("ordering is stable, so a focused card cannot jump between renders", () => {
  const jobs = jobsFor(["Product Manager A", "Product Manager B", "Product Manager C"]);
  const a = filterRelevant(jobs, { targetRoles: ["Product Manager"] }).map((j) => j.id);
  const b = filterRelevant([...jobs].reverse(), { targetRoles: ["Product Manager"] }).map((j) => j.id);
  assert.deepEqual(a, b, "the same set in a different order must rank identically");
});

test("the retained set is bounded", () => {
  const jobs = jobsFor(Array.from({ length: 200 }, (_, i) => `Product Manager ${i}`));
  const out = filterRelevant(jobs, { targetRoles: ["Product Manager"], limit: 40 });
  assert.equal(out.length, 40);
});

// ── Scope honesty ─────────────────────────────────────────────────────────

test("the scope sentence states a board count, never 'all jobs'", () => {
  const scope = scopeDescription(enabledBoards());
  assert.match(scope, /^\d+ curated .+ boards$/);
  assert.doesNotMatch(scope, /all jobs|every job|entire/i);
});

test("every curated board names its vendor explicitly", () => {
  for (const b of CURATED_BOARDS) {
    // An explicit provider is what turns a vendor migration into a visible
    // error instead of detect() quietly resolving nothing.
    assert.ok(["greenhouse", "lever", "ashby"].includes(b.provider), `${b.name} needs a vendor`);
    assert.match(b.careers_url, /^https:\/\//);
  }
});

test("the curated list is bounded — not the whole ATS directory", () => {
  // Milestone 4: "Do not run the entire ATS company directory on every upload."
  assert.ok(CURATED_BOARDS.length <= 60, "a curated list, not 28,746 companies");
  assert.ok(CURATED_BOARDS.length >= 10, "but large enough to be useful");
});
