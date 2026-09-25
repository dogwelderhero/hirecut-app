"use client";

/**
 * The role card, shared by Explore (§5) and Top Matches (§6).
 *
 * §6 requires the SAME card design in both places, with the match panel added
 * on the right. Rules encoded here:
 *  - The match percentage is a fixed translucent green circle. `whitespace-nowrap`
 *    plus a fixed size is the "never split the percentage across lines" rule.
 *  - Unscored jobs get NO ring — "Not scored", never a default 98%.
 *  - Missing facts are omitted or labelled unknown. No funding, valuation,
 *    alumni or applicant chips: §5 lists those as absent unless a real source
 *    exists.
 *  - There is no "Ask Orion" control.
 *  - The employer link performs its native action and must not be swallowed by
 *    card selection, so it stops propagation.
 */

import { ExternalLink, Bookmark, ChevronDown } from "lucide-react";
import type { Job, MatchAssessment } from "@/lib/hirecute/contracts";
import { matchPresentation, postingAgeLabel, MATCH_LABEL, NOT_SCORED_LABEL } from "@/lib/hirecute/match";
import { cn } from "@/lib/cn";

/** The translucent green circle. Fixed size so the number cannot wrap. */
export function MatchRing({ percent }: { percent: number }) {
  return (
    <div
      className="flex size-[46px] shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold whitespace-nowrap tabular-nums"
      style={{
        background: "var(--hc-match-badge-bg)",
        borderColor: "var(--hc-match-badge-line)",
        color: "var(--hc-match-ring)",
      }}
      title={`${percent}% ${MATCH_LABEL}`}
    >
      {percent}%
    </div>
  );
}

function CompanyMark({ company }: { company: string }) {
  // Neutral initial fallback. §5: a logo comes from a known asset/domain
  // mapping or this — never a guessed remote URL.
  return (
    <div
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary text-[13px] font-semibold text-muted-foreground"
    >
      {company.slice(0, 1).toUpperCase()}
    </div>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

export function JobCard({
  job,
  assessment,
  saved,
  expanded,
  onToggleSave,
  onToggleExpand,
  showMatchPanel = false,
}: {
  job: Job;
  assessment?: MatchAssessment | null;
  saved?: boolean;
  expanded?: boolean;
  onToggleSave?: () => void;
  onToggleExpand?: () => void;
  /** Top Matches adds the score panel; Explore renders the same card without it. */
  showMatchPanel?: boolean;
}) {
  const presentation = matchPresentation(assessment);

  return (
    <article className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-[var(--hc-border-strong)]">
      <div className="flex items-start gap-3">
        <CompanyMark company={job.company} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold">{job.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span>{job.company}</span>
            {/* Location is a provider/JD fact; omitted entirely if absent. */}
            {job.location && <span>· {job.location}</span>}
            {/* A missing date reads "Date not listed", never "Just posted". */}
            <span>· {postingAgeLabel(job.postedAt)}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {job.workStyle && <Fact>{job.workStyle}</Fact>}
            {job.employmentType && <Fact>{job.employmentType.replace("_", " ")}</Fact>}
            {job.seniority && <Fact>{job.seniority}</Fact>}
            {/* Salary only from a sourced amount; no sample-range fallback. */}
            {job.salary ? (
              <Fact>{job.salary.advertisedText}</Fact>
            ) : (
              <Fact>Salary not listed</Fact>
            )}
            <Fact>via {job.source.provider}</Fact>
          </div>
        </div>

        {showMatchPanel && (
          <div className="flex flex-col items-center gap-1">
            {presentation ? (
              <>
                <MatchRing percent={presentation.matchPercent} />
                <span className="text-[10px] whitespace-nowrap text-muted-foreground">
                  {MATCH_LABEL}
                </span>
              </>
            ) : (
              /* No ring at all for an unscored job. */
              <span className="rounded-md border border-border px-2 py-1 text-[11px] whitespace-nowrap text-muted-foreground">
                {NOT_SCORED_LABEL}
              </span>
            )}
          </div>
        )}
      </div>

      {showMatchPanel && presentation && assessment && (
        <div
          className="mt-3 rounded-lg border p-2.5"
          style={{ borderColor: "var(--hc-match-panel-border)", background: "rgba(139,232,182,.05)" }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-primary">
            {assessment.recommendation === "apply" ? "Strong fit" : "Worth a look"}
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {assessment.strengths.slice(0, 2).map((s) => (
              <li key={s} className="text-[12px] leading-snug text-muted-foreground">
                · {s}
              </li>
            ))}
          </ul>
          {/* Gaps and blockers are shown separately from the number. */}
          {assessment.gaps.length > 0 && (
            <div className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
              <span className="text-[var(--hc-warning)]">Worth checking:</span>{" "}
              {assessment.gaps[0]}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSave}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] transition-colors",
            saved
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-secondary",
          )}
        >
          <Bookmark className="size-3" /> {saved ? "Saved" : "Save"}
        </button>

        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded ?? false}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary"
        >
          View role
          <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
        </button>

        {/*
          The real posting URL. stopPropagation keeps the native link action
          from being swallowed by card selection (§7 acceptance check).
        */}
        <a
          href={job.source.canonicalPostingUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary"
        >
          Open posting <ExternalLink className="size-3" />
        </a>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3 text-[13px] leading-relaxed text-muted-foreground">
          {job.descriptionStatus === "missing" ? (
            /* An unreadable JD says so. It is not summarised from nothing. */
            <p>The job description could not be retrieved from this board.</p>
          ) : (
            <p>
              {job.descriptionStatus === "partial"
                ? "Partial description retrieved from the provider."
                : "Full description retrieved from the provider."}{" "}
              Open the posting for the employer&rsquo;s own copy.
            </p>
          )}
          {assessment && assessment.blockers.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {assessment.blockers.map((b) => (
                <li key={b.code} className="text-[12px] text-[var(--hc-warning)]">
                  {b.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
