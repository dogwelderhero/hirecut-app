import { test } from "node:test";
import assert from "node:assert/strict";
import "../helpers/web-ts-alias-loader.mjs";

const { matchPresentation, rankByScore, postingAgeLabel, MATCH_LABEL, MATCH_EXPLANATION } =
  await import("../../src/lib/hirecute/match.ts");
const { resolveHash, showsCreditsBanner, SCREEN_HASH } = await import(
  "../../src/lib/hirecute/screens.ts"
);
const { FIXTURE_ASSESSMENTS, FIXTURE_JOBS, fixtureApplications } = await import(
  "../../src/lib/hirecute/fixtures.ts"
);
const { refineReceipt, rankingActionLabel, exploreReceipt } = await import(
  "../../src/lib/hirecute/actions.ts"
);

// ── Score presentation (02-screen-guide.md §6) ──────────────────────────────

test("the display percentage is exactly round(score5 / 5 * 100)", () => {
  for (const [score5, percent] of [
    [5, 100],
    [4.6, 92],
    [4, 80],
    [3.8, 76],
    [3.2, 64],
    [1, 20],
  ]) {
    assert.equal(matchPresentation({ score5 }).matchPercent, percent, `${score5} → ${percent}%`);
  }
});

test("every fixture percentage equals its stored score conversion", () => {
  for (const a of FIXTURE_ASSESSMENTS) {
    assert.equal(matchPresentation(a).matchPercent, Math.round((a.score5 / 5) * 100));
  }
});

test("an absent or invalid evaluation is Not scored, never a default percentage", () => {
  for (const bad of [null, undefined, {}, { score5: null }, { score5: 0 }, { score5: 7 }, { score5: NaN }]) {
    assert.equal(matchPresentation(bad), null, `${JSON.stringify(bad)} must not produce a ring`);
  }
});

test("the label is a profile match, not an interview probability", () => {
  assert.equal(MATCH_LABEL, "profile match");
  assert.match(MATCH_EXPLANATION, /not an interview probability/);
  assert.equal(matchPresentation({ score5: 4.6 }).explanation, MATCH_EXPLANATION);
});

test("job-5 has no assessment because its JD was never retrieved", () => {
  const notion = FIXTURE_JOBS.find((j) => j.id === "job-5");
  assert.equal(notion.descriptionStatus, "missing");
  assert.equal(
    FIXTURE_ASSESSMENTS.some((a) => a.jobId === "job-5"),
    false,
    "a failed JD fetch is not scored as the job",
  );
});

test("ranking is score-descending, stable, and keeps unscored jobs last", () => {
  const ranked = rankByScore([
    { jobId: "b", score5: 4.0 },
    { jobId: "a", score5: 4.0 },
    { jobId: "unscored", score5: null },
    { jobId: "c", score5: 4.6 },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.jobId),
    ["c", "a", "b", "unscored"],
    "ties break deterministically so a focused card cannot jump",
  );
});

// ── Posting age (§5) ───────────────────────────────────────────────────────

test("a missing posting date reads Date not listed, never Just posted", () => {
  for (const bad of [null, undefined, "", "not-a-date"]) {
    assert.equal(postingAgeLabel(bad), "Date not listed");
  }
});

test("posting age is derived from postedAt, not from fetch time", () => {
  const now = Date.parse("2026-09-25T00:00:00.000Z");
  assert.equal(postingAgeLabel("2026-09-25T00:00:00.000Z", now), "Posted today");
  assert.equal(postingAgeLabel("2026-09-24T00:00:00.000Z", now), "Posted yesterday");
  assert.equal(postingAgeLabel("2026-09-20T00:00:00.000Z", now), "Posted 5 days ago");
  assert.equal(postingAgeLabel("2026-07-25T00:00:00.000Z", now), "Posted 2 months ago");
});

// ── Screens and historical hashes (§1) ────────────────────────────────────

test("result-phase hashes canonicalize onto their screen: 4→3, 6→5, 8→7, 10→9", () => {
  assert.equal(resolveHash("#state-4", true), "refine");
  assert.equal(resolveHash("#state-6", true), "explore");
  assert.equal(resolveHash("#state-8", true), "matches");
  assert.equal(resolveHash("#state-10", true), "bulk_apply");
});

test("removed screens fall back without resurrecting their content", () => {
  // 12/17 were the removed activation/outcome screens → checkout overlay.
  assert.equal(resolveHash("#state-12", true), "checkout");
  assert.equal(resolveHash("#state-17", true), "checkout");
  // 13/14 were application-progress screens → Bulk Apply. 15 → upload. 16 → Explore.
  assert.equal(resolveHash("#state-13", true), "bulk_apply");
  assert.equal(resolveHash("#state-14", true), "bulk_apply");
  assert.equal(resolveHash("#state-15", true), "upload");
  assert.equal(resolveHash("#state-16", true), "explore");
});

test("a hash requiring a run falls back to upload when there is none", () => {
  // "Old 2 can enter Finetune only when a run exists; otherwise return to upload."
  assert.equal(resolveHash("#state-2", true), "refine");
  assert.equal(resolveHash("#state-2", false), "upload");
  // A copied checkout link must not present a workspace with no artifacts.
  assert.equal(resolveHash("#state-11", false), "upload");
  assert.equal(resolveHash("#state-9", false), "upload");
});

test("unknown and absent hashes are safe", () => {
  assert.equal(resolveHash("#state-999", false), "upload");
  assert.equal(resolveHash("#nonsense", true), "refine");
  assert.equal(resolveHash(null, false), "upload");
});

test("canonical hashes preserve the historical numbering", () => {
  assert.deepEqual(SCREEN_HASH, {
    upload: "state-1",
    refine: "state-3",
    explore: "state-5",
    matches: "state-7",
    bulk_apply: "state-9",
    checkout: "state-11",
  });
});

test("the credits banner starts at Top Matches, not at Explore", () => {
  assert.equal(showsCreditsBanner("upload"), false);
  assert.equal(showsCreditsBanner("refine"), false);
  assert.equal(showsCreditsBanner("explore"), false, "§6: the banner begins at step 3, not Explore");
  assert.equal(showsCreditsBanner("matches"), true);
  assert.equal(showsCreditsBanner("bulk_apply"), true, "it persists into Bulk Apply");
});

// ── Receipt copy uses real counts (§4, §6) ────────────────────────────────

test("a no-change refinement says Resume reviewed rather than inventing changes", () => {
  assert.equal(refineReceipt(0), "Resume reviewed · Original kept");
  assert.equal(refineReceipt(1), "Resume refined · 1 improvement · Original kept");
  assert.equal(refineReceipt(3), "Resume refined · 3 improvements · Original kept");
});

test("the ranking action omits a count when the shortlist size is unknown", () => {
  assert.equal(rankingActionLabel(null), "Ranking your top roles");
  assert.equal(rankingActionLabel(0), "Ranking your top roles");
  assert.equal(rankingActionLabel(1), "Ranking your top 1 role");
  assert.equal(rankingActionLabel(4), "Ranking your top 4 roles");
});

test("partial discovery is reported as a result with coverage, not an error", () => {
  assert.match(exploreReceipt(5, 1), /5 roles saved · some sources unavailable/);
  assert.match(exploreReceipt(5, 0), /5 roles saved · duplicates removed/);
});

// ── Capability honesty (brief: "Capability decision you must preserve") ───

test("with submission disabled every fixture package is manual_only and never submitted", () => {
  for (const pkg of fixtureApplications()) {
    assert.equal(pkg.capability.kind, "manual_only");
    assert.equal(pkg.capability.reason, "pilot_disabled");
    assert.equal(
      pkg.submission.status,
      "not_approved",
      "no package may claim to have been submitted",
    );
  }
});

test("a package missing a candidate answer is needs_input, never silently guessed", () => {
  const blocked = fixtureApplications().find((p) => p.jobId === "job-2");
  assert.equal(blocked.readiness.status, "needs_input");
  assert.deepEqual(blocked.readiness.missingAnswerIds, ["work_authorization"]);
});

test("no fixture invents a recruiter address", () => {
  for (const job of FIXTURE_JOBS) {
    assert.equal(job.recruiter.status, "unknown");
    assert.equal(job.recruiter.email, null);
    assert.match(job.recruiter.displayName, /^Hiring team · /);
  }
});

test("a job with no published salary omits it rather than falling back to a range", () => {
  const noSalary = FIXTURE_JOBS.filter((j) => j.salary === null);
  assert.ok(noSalary.length >= 3, "most fixtures publish no salary, as most real postings do not");
  const withSalary = FIXTURE_JOBS.find((j) => j.salary !== null);
  assert.equal(withSalary.salary.currency, "GBP");
  assert.ok(withSalary.salary.evidenceIds.length > 0, "a shown salary carries evidence");
});
