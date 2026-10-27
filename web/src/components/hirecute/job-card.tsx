"use client";

/**
 * The role card — `article.hc-sr-card`.
 *
 * Ported from screens 05 (Explore) and 07 (Top matches). §6 requires the SAME
 * card in both places, with the match panel added on the right, which is how
 * the reference does it: `hc-sr-card.hc-topmatch-card` wraps the body in
 * `div.hc-topmatch-body` and appends `aside.hc-match-panel`.
 *
 * The reference's six fact rows line up exactly with the six optional fields on
 * `Job` (location, employmentType, salary, workStyle, seniority,
 * experienceYearsMin) — each row renders only when its field is present, so a
 * board that publishes little produces a shorter card rather than a padded one.
 *
 * Honesty rules from §5, all about what NOT to render:
 *  - a missing date is "Date not listed", never derived from fetch time
 *  - salary comes from a sourced amount or is omitted
 *  - the reference's `Series B` / `B2B SaaS` chips and its "Fewer than 25
 *    applicants" line are dropped: funding, valuation, alumni and applicant
 *    counts have no source, and `Job` deliberately has no field for them
 *  - an unscored job gets NO ring — never a default percentage
 *  - there is no "Ask Orion" control
 */

import type { Job, MatchAssessment } from "@/lib/hirecute/contracts";
import {
  NOT_SCORED_LABEL,
  matchPresentation,
  postingAgeLabel,
  providerLabel,
} from "@/lib/hirecute/match";

/** The reference's inline icon: `svg.hc-sr-icon`, 24×24, stroked. */
function Icon({ d, extra }: { d: string[]; extra?: React.ReactNode }) {
  return (
    <svg
      className="hc-sr-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
      {extra}
    </svg>
  );
}

const PIN = ["M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"];
const CLOCK = ["M12 7v5l3 2"];
const HOUSE = ["m3 10 9-7 9 7v10H3Z", "M9 20v-7h6v7"];
const BADGE = ["M12 3l2 4 4 .6-3 3 .7 4.4-3.7-2-3.7 2 .7-4.4-3-3 4-.6Z"];
const CASE = ["M3 7h18v14H3z", "M8 7V3h8v4M3 12c6 3 12 3 18 0M12 12v3"];
const SPARK = ["m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"];
const HEART = ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"];
const ARROW = ["M4 12h16m-6-6 6 6-6 6"];

const EVIDENCE_MARK = { strong: "✓", partial: "◐", missing: "✕", not_applicable: "–" } as const;
const EVIDENCE_LABEL = {
  strong: "Met",
  partial: "Partly met",
  missing: "Missing",
  not_applicable: "Not applicable",
} as const;

const WORK_STYLE: Record<NonNullable<Job["workStyle"]>, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};

const EMPLOYMENT: Record<NonNullable<Job["employmentType"]>, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  other: "Other",
};

/**
 * The reference's ring: an SVG arc whose length IS the percentage
 * (`stroke-dasharray="{n} 100"` over `pathLength="100"`), under a
 * blue→green gradient. The gradient id must be unique per card, or every ring
 * on the page resolves to the first one.
 */
export function MatchRing({ percent, id }: { percent: number; id: string }) {
  const gradientId = `match-gradient-${id}`;
  return (
    <div className="hc-match-ring" role="img" aria-label={`${percent} percent match`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop className="hc-match-blue" offset="0%" />
            <stop className="hc-match-green" offset="100%" />
          </linearGradient>
        </defs>
        <circle className="hc-match-track" cx="60" cy="60" r="51" />
        <circle
          className="hc-match-arc"
          cx="60"
          cy="60"
          r="51"
          pathLength={100}
          stroke={`url(#${gradientId})`}
          strokeDasharray={`${percent} 100`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="hc-match-percent" aria-hidden="true">
        <strong>{percent}</strong>
        <span>%</span>
      </div>
    </div>
  );
}

function CardBody({
  job,
  assessment,
  saved,
  expanded,
  onToggleSave,
  onToggleExpand,
}: {
  job: Job;
  assessment?: MatchAssessment | null;
  saved?: boolean;
  expanded?: boolean;
  onToggleSave?: () => void;
  onToggleExpand?: () => void;
}) {
  const detailId = `job-detail-${job.id}`;
  // Requirements whose posting line the worker verified verbatim.
  const evidence = (assessment?.requirements ?? []).filter((r) => r.jobQuote);
  // What this job asks for that the resume does not (fully) show.
  const gapCount = evidence.filter((r) => r.match === "partial" || r.match === "missing").length;
  const age = postingAgeLabel(job.postedAt);
  const fresh = /hour|hours|today|1 day/i.test(age);

  return (
    <>
      <header className="hc-sr-card-head">
        {/* Neutral initial fallback — never a guessed remote logo URL. */}
        <div className="hc-sr-logo" aria-hidden>
          {job.company.slice(0, 1).toUpperCase()}
        </div>
        <div className="hc-sr-card-title">
          <div className="hc-sr-badges">
            <span className={`hc-sr-badge${fresh ? " hc-sr-badge--fresh" : ""}`}>{age}</span>
            <span className="hc-sr-badge">via {providerLabel(job.source.provider)}</span>
            {gapCount > 0 && (
              <span className="hc-sr-badge hc-sr-badge--gap">
                {gapCount} gap{gapCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <h2>{job.title}</h2>
          <p>
            {/* No company tagline exists in our data, so no " / " either. */}
            <strong>{job.company}</strong>
          </p>
        </div>
      </header>

      <div className="hc-sr-facts">
        {job.location && (
          <div>
            <Icon d={PIN} extra={<circle cx="12" cy="10" r="2.5" />} />
            <span>{job.location}</span>
          </div>
        )}
        {job.employmentType && (
          <div>
            <Icon d={CLOCK} extra={<circle cx="12" cy="12" r="9" />} />
            <span>{EMPLOYMENT[job.employmentType]}</span>
          </div>
        )}
        {job.salary ? (
          <div className="hc-sr-salary">
            <Icon
              d={["M6 12h.01M18 12h.01"]}
              extra={
                <>
                  <rect x="2" y="5" width="20" height="14" rx="3" />
                  <circle cx="12" cy="12" r="3" />
                </>
              }
            />
            <span>{job.salary.advertisedText}</span>
          </div>
        ) : (
          <div>
            <span className="hc-muted">Salary not listed</span>
          </div>
        )}
        {job.workStyle && (
          <div>
            <Icon d={HOUSE} />
            <span>{WORK_STYLE[job.workStyle]}</span>
          </div>
        )}
        {job.seniority && (
          <div>
            <Icon d={BADGE} />
            <span>{job.seniority}</span>
          </div>
        )}
        {job.experienceYearsMin !== null && (
          <div>
            <Icon d={CASE} />
            <span>{job.experienceYearsMin}+ years experience</span>
          </div>
        )}
      </div>

      {/* Only ever the model's own evidence sentence. */}
      {assessment && assessment.strengths.length > 0 && (
        <div className="hc-sr-fit">
          <Icon d={SPARK} />
          <span>{assessment.strengths[0]}</span>
        </div>
      )}

      <footer className="hc-sr-card-foot">
        {/*
          The reference's "Fewer than 25 applicants" is replaced by something we
          can actually source: how complete the description we retrieved is.
        */}
        <span className="hc-sr-early">
          {job.descriptionStatus === "missing"
            ? "Description unavailable"
            : job.descriptionStatus === "partial"
              ? "Partial description"
              : "Full description retrieved"}
        </span>
        <div className="hc-sr-actions">
          {onToggleSave && (
          <button
            type="button"
            className="hc-sr-save"
            aria-pressed={saved ?? false}
            aria-label={`Save ${job.title} at ${job.company}`}
            onClick={onToggleSave}
          >
            <Icon d={HEART} />
            <span>{saved ? "Saved" : "Save"}</span>
          </button>
          )}
          <button
            type="button"
            className="hc-sr-view"
            aria-expanded={expanded ?? false}
            aria-controls={detailId}
            onClick={onToggleExpand}
          >
            <span>
              {evidence.length > 0
                ? expanded
                  ? "Hide the evidence"
                  : "See the evidence"
                : expanded
                  ? "Hide role"
                  : "View role"}
            </span>
            <Icon d={ARROW} />
          </button>
        </div>
      </footer>

      <section className="hc-sr-detail" id={detailId} hidden={!expanded}>
        {evidence.length > 0 && (
          <>
            <h3>What this job asks for, and what your resume shows</h3>
            <ul className="hc-ev-list">
              {evidence.map((r, i) => (
                <li key={`${r.requirement}-${i}`} className={`is-${r.match}`}>
                  <span className="hc-ev-mark" aria-label={EVIDENCE_LABEL[r.match]}>
                    {EVIDENCE_MARK[r.match]}
                  </span>
                  <div>
                    <strong>
                      {r.requirement}
                      {r.importance === "nice_to_have" && <small> · nice to have</small>}
                    </strong>
                    <p className="hc-ev-quote">
                      <span>Job</span>“{r.jobQuote}”
                    </p>
                    {r.resumeQuote ? (
                      <p className="hc-ev-quote is-you">
                        <span>You</span>“{r.resumeQuote}”
                      </p>
                    ) : (
                      r.match !== "not_applicable" && (
                        <p className="hc-ev-quote is-none">
                          <span>You</span>Not shown in your resume
                        </p>
                      )
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {evidence.length === 0 && <h3>A closer look</h3>}
        {/*
          The reference prints three invented responsibility bullets. We hold
          the employer's description as an artifact, not as sentences we may
          paraphrase into bullets, so this states what we retrieved and sends
          the visitor to the employer's own copy.
        */}
        <p>
          {evidence.length > 0
            ? null
            : job.descriptionStatus === "missing"
            ? "The job description could not be retrieved from this board."
            : job.descriptionStatus === "partial"
              ? "Only part of the description was published through this board’s API."
              : "The full description was retrieved from this board’s API."}
        </p>
        {evidence.length === 0 && assessment && assessment.gaps.length > 0 && (
          <div className="hc-match-evidence">
            <strong>Worth checking</strong>
            <p>{assessment.gaps[0]}</p>
          </div>
        )}
        {assessment && assessment.blockers.length > 0 && (
          <ul>
            {assessment.blockers.map((b, i) => (
              <li key={`${b.code}-${i}`}>{b.description}</li>
            ))}
          </ul>
        )}
        <p className="hc-sr-skills">
          {/*
            The real posting URL. stopPropagation keeps the native link action
            from being swallowed by card selection (§7 acceptance check).
          */}
          <a
            href={job.source.canonicalPostingUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            data-hc-origin="link"
          >
            Open the employer’s posting ↗
          </a>
        </p>
      </section>
    </>
  );
}

export function JobCard(props: {
  job: Job;
  assessment?: MatchAssessment | null;
  saved?: boolean;
  expanded?: boolean;
  onToggleSave?: () => void;
  onToggleExpand?: () => void;
  /** Top matches adds the score panel; Explore renders the same card without it. */
  showMatchPanel?: boolean;
  /** Scoring is running and this job is not scored yet. */
  pending?: boolean;
}) {
  const { showMatchPanel, pending, ...body } = props;
  const reqs = props.assessment?.requirements ?? [];
  const count = (m: string) => reqs.filter((r) => r.match === m).length;
  const presentation = matchPresentation(props.assessment);

  if (!showMatchPanel) {
    return (
      <article className="hc-sr-card">
        <CardBody {...body} />
      </article>
    );
  }

  return (
    <article className="hc-sr-card hc-topmatch-card">
      <div className="hc-topmatch-body">
        <CardBody {...body} />
      </div>
      <aside
        className="hc-match-panel"
        aria-label={
          presentation ? `${presentation.matchPercent} percent match` : NOT_SCORED_LABEL
        }
      >
        {presentation ? (
          <>
            <MatchRing percent={presentation.matchPercent} id={props.job.id} />
            <h3>{presentation.band.toUpperCase()} MATCH</h3>
            {reqs.length > 0 && (
              <p
                className="hc-ev-tally"
                aria-label={`${count("strong")} met, ${count("partial")} partly met, ${count("missing")} missing`}
              >
                <span>✓ {count("strong")}</span>
                <span>◐ {count("partial")}</span>
                <span>✕ {count("missing")}</span>
              </p>
            )}
            {/*
              The reference's panel lists two SHORT reasons ("B2B SaaS
              experience"). `requirements[].requirement` is that shape already
              — the strengths array holds full sentences, which overflow the
              panel and repeat the `hc-sr-fit` line directly to its left. Only
              requirements the model marked "strong" are listed, and nothing is
              invented to reach two.
            */}
            <ul>
              {(props.assessment?.requirements ?? [])
                .filter((r) => r.match === "strong")
                .slice(0, 2)
                .map(({ requirement: reason }, i) => (
                <li key={`${reason}-${i}`}>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="m4 10 4 4 8-9" />
                  </svg>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          /* No ring at all for an unscored job. */
          <span className={`hc-tag${pending ? " hc-ev-pending" : ""}`}>
            {pending ? "Reading the job…" : NOT_SCORED_LABEL}
          </span>
        )}
      </aside>
    </article>
  );
}
