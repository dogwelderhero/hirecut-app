"use client";

/**
 * The right half of the resume review screen: roles found for this resume,
 * appearing as each board finishes — not after the whole sweep.
 *
 * Built from Bulk Apply's list markup (`section.hc-ap-list`, `article.hc-ap-row`
 * with `hc-ap-mark` + `hc-ap-row-body` + `hc-ap-row-end`) so the two screens
 * read as one product. There is no checkbox column: nothing is being selected
 * yet, so a row is mark + body + match.
 *
 * Honesty rules carried over from the Explore screen:
 *  - Only real postings, as discovered. A count is the number of rows shown.
 *  - While searching, rows follow the worker's provisional ranking
 *    (`explore.progress`), capped at the retained number, so a stronger role
 *    replaces a weaker one instead of the list piling up. Once the search
 *    finishes, the explore result is the list.
 *  - A match percentage appears only once that role has actually been scored.
 */

import type { Job, JobId, MatchAssessment, PublicError, SearchCoverage } from "@/lib/hirecute/contracts";
import { matchPresentation, providerLabel } from "@/lib/hirecute/match";
import { ExternalIcon, WORK_STYLE } from "./bulk-apply";

export function FoundJobs({
  jobs,
  order,
  finalIds,
  progress,
  assessments,
  coverage,
  searching,
  boardCount,
  error,
}: {
  jobs: Record<JobId, Job>;
  /** Discovery order — the fallback before any ranking has arrived. */
  order: JobId[];
  /** The explore result's job IDs, once the search has finished. */
  finalIds: JobId[] | null;
  /** The provisional ranking while the search runs. */
  progress: { jobIds: JobId[]; boardsDone: number; boardsTotal: number } | null;
  assessments: Record<JobId, MatchAssessment>;
  coverage: SearchCoverage | null;
  searching: boolean;
  boardCount: number;
  error: PublicError | null;
}) {
  // Final list, else the current provisional ranking, else discovery order.
  const ids = (finalIds ?? progress?.jobIds ?? order).filter((id) => jobs[id]);

  // Scored roles rise to the top as matching completes; the rest keep their
  // ranked order beneath them.
  const scored = ids
    .filter((id) => matchPresentation(assessments[id]))
    .sort((a, b) => assessments[b].score5 - assessments[a].score5);
  const rows = [...scored, ...ids.filter((id) => !matchPresentation(assessments[id]))];

  const status = searching
    ? progress
      ? `${rows.length} found so far · ${progress.boardsDone} of ${progress.boardsTotal} boards checked`
      : `Searching ${boardCount} boards…`
    : coverage
      ? `${rows.length} found across ${coverage.boardsSucceeded} of ${coverage.boardsAttempted} boards`
      : `${rows.length} found`;

  return (
    <section className="hc-ap-list hc-found" aria-label="Jobs found for this resume" aria-live="polite">
      <div className="hc-ap-list-head">
        <div>
          <h2>JOBS FOR THIS RESUME</h2>
          <span>{status}</span>
        </div>
      </div>

      <div className="hc-ap-list-scroll">
        {rows.map((id, i) => {
          const job = jobs[id];
          const presentation = matchPresentation(assessments[id]);
          // Skip a work style the location line already states, and never
          // print the raw enum value.
          const style = job.workStyle ? WORK_STYLE[job.workStyle] : null;
          const meta = [
            job.location,
            style && !job.location?.toLowerCase().includes(style.toLowerCase()) ? style : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <article key={id} className="hc-ap-row hc-found-row">
              <div className={`hc-ap-mark hc-ap-mark--${i % 4}`} aria-hidden="true">
                <span>{job.company.slice(0, 1).toUpperCase()}</span>
              </div>
              <div className="hc-ap-row-body">
                <div className="hc-ap-pick">
                  <strong>{job.title}</strong>
                  <span title={meta ? `${job.company} · ${meta}` : job.company}>
                    <span>{job.company}</span>
                    {meta && <span> · {meta}</span>}
                  </span>
                </div>
                <div className="hc-ap-row-meta">
                  <span className="hc-ap-provider">{providerLabel(job.source.provider)}</span>
                </div>
                <a
                  href={job.source.applicationUrl ?? job.source.canonicalPostingUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-hc-origin="link"
                >
                  <span>Job posting</span>
                  <ExternalIcon />
                </a>
              </div>
              {presentation && (
                <div className="hc-ap-row-end" aria-label={`${presentation.matchPercent}% match`}>
                  <strong>{presentation.matchPercent}%</strong>
                </div>
              )}
            </article>
          );
        })}
        {rows.length === 0 && (
          <p className="hc-ap-muted hc-found-empty">
            {error
              ? error.message
              : searching
                ? `Checking ${boardCount} company career pages. Roles appear here as soon as they are found.`
                : "Your job search starts as soon as your resume is read."}
          </p>
        )}
      </div>
      {searching && rows.length > 0 && (
        <div className="hc-ap-list-foot">Still searching. Early results may be replaced by stronger matches.</div>
      )}
    </section>
  );
}
