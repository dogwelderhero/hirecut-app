/**
 * Deterministic fixtures for Milestone 1.
 *
 * These drive the six-screen journey before any upstream service is connected,
 * and they back the contract tests. Three constraints from the brief:
 *
 *  1. "Provide deterministic fixture adapters in tests. A fixture mode may be
 *     explicitly marked as local/demo; never silently fall back to mock results
 *     when a real provider or model fails." Hence `FIXTURE_ORIGIN = "sample"`
 *     and the `isFixture` flag — a fixture run is always identifiable and is
 *     excluded from live conversion analytics.
 *  2. "Do not persist the prototype's illustrative jobs as live seed results."
 *     Nothing here is written to a run store; it is produced on demand for an
 *     explicitly-marked sample journey.
 *  3. "Do not hardcode the demonstrated Alex Morgan profile." The prototype's
 *     candidate, its 146 jobs, its 98% scores and its masked `.example`
 *     recruiter addresses are all absent. Companies below are real public ATS
 *     tenants, the scores are unremarkable, and every unknown field is
 *     genuinely unknown rather than filled in.
 */

import type {
  ApplicationPackage,
  Job,
  MatchAssessment,
  RefinementChange,
  SearchCoverage,
} from "./contracts";

export const FIXTURE_RUN_ID = "sample-run";
/** A fixture journey is a sample run. It never counts as a live conversion. */
export const FIXTURE_ORIGIN = "sample" as const;

const FETCHED_AT = "2026-09-25T09:00:00.000Z";

function source(
  provider: Job["source"]["provider"],
  slug: string,
  jobId: string,
): Job["source"] {
  const host =
    provider === "greenhouse"
      ? `https://job-boards.greenhouse.io/${slug}/jobs/${jobId}`
      : provider === "lever"
        ? `https://jobs.lever.co/${slug}/${jobId}`
        : `https://jobs.ashbyhq.com/${slug}/${jobId}`;
  return {
    provider,
    providerJobId: jobId,
    canonicalPostingUrl: host,
    applicationUrl: host,
    fetchedAt: FETCHED_AT,
    postingContentHash: `sha256:fixture-${jobId}`,
    liveStatus: "unverified",
    verifiedAt: null,
  };
}

/** Recruiter is unknown for every fixture: §7 forbids inventing an address. */
function hiringTeam(company: string): Job["recruiter"] {
  return {
    status: "unknown",
    company,
    displayName: `Hiring team · ${company}`,
    email: null,
    reason: "contact_not_listed",
  };
}

export const FIXTURE_JOBS: Job[] = [
  {
    id: "job-1",
    company: "Monzo",
    title: "Senior Product Manager, Payments",
    source: source("greenhouse", "monzo", "5510001"),
    location: "London, United Kingdom",
    workStyle: "hybrid",
    employmentType: "full_time",
    seniority: "Senior",
    experienceYearsMin: 5,
    postedAt: "2026-09-22T00:00:00.000Z",
    salary: null, // Not published. §5: omit rather than fall back to a range.
    descriptionArtifactId: "art-jd-1",
    descriptionStatus: "full",
    recruiter: hiringTeam("Monzo"),
    evidenceIds: ["ev-1"],
  },
  {
    id: "job-2",
    company: "Monzo",
    // Deliberately a second requisition at the same employer: the dedup rule
    // must keep distinct roles distinct (§5 acceptance check).
    title: "Group Product Manager, Lending",
    source: source("greenhouse", "monzo", "5510044"),
    location: "London, United Kingdom",
    workStyle: "hybrid",
    employmentType: "full_time",
    seniority: "Lead",
    experienceYearsMin: 7,
    postedAt: "2026-09-19T00:00:00.000Z",
    salary: null,
    descriptionArtifactId: "art-jd-2",
    descriptionStatus: "full",
    recruiter: hiringTeam("Monzo"),
    evidenceIds: ["ev-2"],
  },
  {
    id: "job-3",
    company: "Wise",
    title: "Product Lead, Money Movement",
    source: source("lever", "wise", "a71f2c90"),
    location: "London, United Kingdom",
    workStyle: "hybrid",
    employmentType: "full_time",
    seniority: "Lead",
    experienceYearsMin: null,
    // No published date. Renders "Date not listed", never "Just posted".
    postedAt: null,
    salary: null,
    descriptionArtifactId: "art-jd-3",
    descriptionStatus: "partial",
    recruiter: hiringTeam("Wise"),
    evidenceIds: [],
  },
  {
    id: "job-4",
    company: "Linear",
    title: "Head of Product Operations",
    source: source("ashby", "linear", "c0a4e1"),
    location: "Remote (UK)",
    workStyle: "remote",
    employmentType: "full_time",
    seniority: null,
    experienceYearsMin: null,
    postedAt: "2026-09-24T00:00:00.000Z",
    salary: {
      min: 120_000,
      max: 150_000,
      currency: "GBP",
      period: "year",
      advertisedText: "£120,000 – £150,000 per year",
      evidenceIds: ["ev-4"],
    },
    descriptionArtifactId: "art-jd-4",
    descriptionStatus: "full",
    recruiter: hiringTeam("Linear"),
    evidenceIds: ["ev-4"],
  },
  {
    id: "job-5",
    company: "Notion",
    title: "Principal Product Manager, Platform",
    source: source("greenhouse", "notion", "4410233"),
    location: "London, United Kingdom",
    workStyle: "onsite",
    employmentType: "full_time",
    seniority: "Principal",
    experienceYearsMin: 8,
    postedAt: "2026-09-16T00:00:00.000Z",
    salary: null,
    descriptionArtifactId: null,
    // JD could not be retrieved. §6: it must not be scored as if it were read.
    descriptionStatus: "missing",
    recruiter: hiringTeam("Notion"),
    evidenceIds: [],
  },
];

export const FIXTURE_COVERAGE: SearchCoverage = {
  // Partial on purpose: §5 requires a partial result to render as a result.
  status: "partial",
  boardsAttempted: 12,
  boardsSucceeded: 11,
  boardsFailed: 1,
  availableCompanies: null,
  capHit: false,
  staleDataset: false,
  stoppedByOutage: false,
  undatedPostingsDropped: 0,
  jobsFound: 7,
  jobsRetained: 5,
  scopeDescription: "12 curated Greenhouse, Lever and Ashby boards",
  warnings: ["One Ashby board did not respond"],
};

const ASSESSMENT_BASE = {
  confidence: "medium",
  workAuthorization: "unstated",
  legitimacy: "high_confidence",
  sourceResumeHash: "sha256:fixture-resume",
  preferencesVersion: 1,
  modelVersion: "fixture",
  schemaVersion: 1,
  completedAt: "2026-09-25T09:05:00.000Z",
} as const;

/**
 * Scores are ordinary. 4.6/5 → 92%, 3.2/5 → 64%. No 98%, and job-5 has no
 * assessment at all because its JD was never retrieved.
 */
export const FIXTURE_ASSESSMENTS: MatchAssessment[] = [
  {
    ...ASSESSMENT_BASE,
    jobId: "job-1",
    score5: 4.6,
    recommendation: "apply",
    strengths: ["Payments platform ownership at a regulated fintech"],
    gaps: ["No stated experience with card scheme certification"],
    requirements: [
      {
        requirement: "5+ years product management",
        jobEvidenceIds: ["ev-1"],
        candidateFactIds: ["fact-1"],
        match: "strong",
        explanation: "Resume evidences eight years of product ownership.",
      },
    ],
    blockers: [],
    jobContentHash: "sha256:fixture-job-1",
  },
  {
    ...ASSESSMENT_BASE,
    jobId: "job-3",
    score5: 4.0,
    recommendation: "apply",
    strengths: ["Cross-border money movement experience"],
    gaps: ["Lending exposure is not evidenced in the resume"],
    requirements: [
      {
        requirement: "Led a payments roadmap",
        jobEvidenceIds: ["ev-3"],
        candidateFactIds: ["fact-1"],
        match: "partial",
        explanation: "Roadmap ownership is evidenced; the lending slice is not.",
      },
    ],
    blockers: [],
    jobContentHash: "sha256:fixture-job-3",
  },
  {
    ...ASSESSMENT_BASE,
    jobId: "job-4",
    score5: 3.8,
    recommendation: "consider",
    strengths: ["Operations leadership"],
    gaps: ["Role leans further into internal tooling than the resume evidences"],
    requirements: [],
    blockers: [],
    jobContentHash: "sha256:fixture-job-4",
  },
  {
    ...ASSESSMENT_BASE,
    jobId: "job-2",
    score5: 3.2,
    confidence: "low",
    recommendation: "research_first",
    strengths: ["Adjacent domain"],
    gaps: ["Lending P&L ownership not evidenced"],
    requirements: [],
    blockers: [
      {
        code: "required_qualification",
        description: "Posting asks for 7+ years leading lending products",
        evidenceIds: ["ev-2"],
        certainty: "needs_candidate_input",
      },
    ],
    jobContentHash: "sha256:fixture-job-2",
  },
];

export const FIXTURE_REFINEMENT_CHANGES: RefinementChange[] = [
  {
    id: "chg-1",
    kind: "clarity",
    before: "Experienced product person who has worked on lots of fintech things.",
    after: "Product leader with 8 years in regulated fintech, focused on payments platforms.",
    explanation: "Replaced a vague claim with the specifics already present in the experience section.",
    sourceFactIds: ["fact-1"],
  },
  {
    id: "chg-2",
    kind: "formatting",
    before: "• built payments stuff • also did some hiring",
    after: "• Built the payments platform serving card and bank transfers\n• Hired and led a team of six",
    explanation: "Split a compound bullet; no new claims introduced.",
    sourceFactIds: ["fact-1"],
  },
  {
    id: "chg-3",
    kind: "relevance",
    before: "Payments",
    after: "Payments · Card schemes · Bank transfers · Reconciliation",
    explanation: "Surfaced terms already evidenced in the experience bullets.",
    sourceFactIds: ["fact-1"],
  },
];

/**
 * Packages for the fixture journey.
 *
 * `capability.kind` is `manual_only` with reason `pilot_disabled` on every one:
 * submission is disabled by default, so the honest label is "Ready to apply".
 * Nothing here may read "Ready to auto-apply" or "submitted".
 */
export function fixtureApplications(): ApplicationPackage[] {
  const scored = new Set(FIXTURE_ASSESSMENTS.map((a) => a.jobId));
  return FIXTURE_JOBS.filter((j) => scored.has(j.id)).map((job, i) => ({
    jobId: job.id,
    version: 1,
    sourceResumeHash: "sha256:fixture-resume",
    tailoredResumeArtifactId: `art-cv-${job.id}`,
    letterArtifactId: `art-letter-${job.id}`,
    letter: {
      status: "ready",
      current: {
        version: 1,
        author: "model",
        text: fixtureLetterText(job.company, job.title),
        subject: `Application: ${job.title}`,
        updatedAt: "2026-09-25T09:10:00.000Z",
        contentHash: `sha256:fixture-letter-${job.id}`,
        sourceFactIds: ["fact-1"],
        jobContentHash: job.source.postingContentHash,
      },
    },
    answers: [],
    // job-2 carries an unanswered eligibility question, so it is needs_input
    // and excluded from unattended submission — never silently guessed.
    readiness:
      job.id === "job-2"
        ? {
            status: "needs_input",
            missingAnswerIds: ["work_authorization"],
            explanation: "This employer asks about work authorization. Your answer is not on file.",
          }
        : { status: "ready", verifiedAt: "2026-09-25T09:10:00.000Z" },
    capability: { kind: "manual_only", reason: "pilot_disabled" },
    submission: { status: "not_approved" },
    packageHash: i === 0 ? `sha256:fixture-pkg-${job.id}` : null,
  }));
}

export function fixtureLetterText(company: string, title: string): string {
  return [
    `Dear Hiring team at ${company},`,
    "",
    `I am applying for the ${title} role. My background is in payments platforms at regulated fintechs, where I owned the roadmap for card and bank-transfer rails and led a team of six.`,
    "",
    "Two things in the posting stood out. The emphasis on reconciliation matches work I have shipped end to end, and the scope of platform ownership is the part of the job I have most enjoyed in the past.",
    "",
    "I would welcome the chance to talk it through.",
  ].join("\n");
}
