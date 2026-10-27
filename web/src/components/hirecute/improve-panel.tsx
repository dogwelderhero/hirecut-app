"use client";

/**
 * Step 3, right side: what to change to match your top jobs better.
 *
 *  - Your top 3 matches: the best-scored jobs, with their gap counts.
 *  - Changes grouped by the gap they answer. A group opens to its evidence
 *    (the posting lines asking for it, verified verbatim by the worker) and
 *    each change as old → new, with Apply / Undo. "Apply all" applies every
 *    change still waiting.
 *  - Gaps no change can answer (the resume has no proof) are listed last, for
 *    the recruiter call. They are never turned into edits.
 *
 * Applied / skipped state is the workspace's: the resume on the left shows the
 * same changes, and the journey moves on once every change is decided.
 */

import { useState } from "react";
import type { Job, JobId, MatchAssessment, ResumeGap, ResumeRecommendation } from "@/lib/hirecute/contracts";
import { matchPresentation } from "@/lib/hirecute/match";
import { Diff } from "./resume-review";

export function ImprovePanel({
  jobs,
  assessments,
  topJobIds,
  gaps,
  recommendations,
  appliedIds,
  skippedIds,
  onToggle,
  onApplyAll,
}: {
  jobs: Record<JobId, Job>;
  assessments: Record<JobId, MatchAssessment>;
  topJobIds: JobId[];
  gaps: ResumeGap[];
  /** Null while the agent is still writing them. */
  recommendations: ResumeRecommendation[] | null;
  appliedIds: string[];
  skippedIds: string[];
  onToggle: (id: string) => void;
  onApplyAll: () => void;
}) {
  const [openGap, setOpenGap] = useState<string | null>(null);
  const applied = new Set(appliedIds);
  const skipped = new Set(skippedIds);
  const recs = recommendations ?? [];

  // Each change sits under the first gap it answers, so nothing is listed twice.
  const groups = gaps
    .map((gap) => ({ gap, recs: recs.filter((r) => (r.gapIds ?? [])[0] === gap.id) }))
    .filter((g) => g.recs.length > 0);
  const unanswered = gaps.filter((g) => !recs.some((r) => (r.gapIds ?? []).includes(g.id)));
  const waiting = recs.filter((r) => !applied.has(r.id) && !skipped.has(r.id));
  const appliedCount = recs.filter((r) => applied.has(r.id)).length;

  return (
    <aside className="hc-ip" aria-label="Match your top jobs better">
      <section className="hc-panel hc-ip-top">
        <header className="hc-panel-head">
          <span className="hc-label">YOUR TOP {topJobIds.length} MATCHES</span>
        </header>
        <ul className="hc-ip-jobs">
          {topJobIds.map((id) => {
            const job = jobs[id];
            const a = assessments[id];
            const p = matchPresentation(a);
            const gapCount = (a?.requirements ?? []).filter(
              (r) => r.jobQuote && (r.match === "partial" || r.match === "missing"),
            ).length;
            if (!job) return null;
            return (
              <li key={id}>
                <span className="hc-ip-mark" aria-hidden="true">
                  {job.company.slice(0, 1).toUpperCase()}
                </span>
                <span className="hc-ip-job">
                  <strong>{job.title}</strong>
                  <small>{job.company}</small>
                </span>
                {gapCount > 0 && (
                  <span className="hc-sr-badge hc-sr-badge--gap">
                    {gapCount} gap{gapCount === 1 ? "" : "s"}
                  </span>
                )}
                {p && <strong className="hc-ip-score">{p.matchPercent}%</strong>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="hc-panel hc-ip-recs">
        <header className="hc-panel-head hc-ip-head">
          <div>
            <span className="hc-label">RAISE YOUR MATCH</span>
            <p>
              {recommendations === null
                ? "Your agent is turning each gap into a change…"
                : recs.length === 0
                  ? "No change can close these gaps with what your resume shows. Talk them through with a recruiter."
                  : `${appliedCount} of ${recs.length} change${recs.length === 1 ? "" : "s"} applied`}
            </p>
          </div>
          {waiting.length > 0 && (
            <button type="button" className="hc-button hc-ip-applyall" onClick={onApplyAll}>
              Apply all {waiting.length}
            </button>
          )}
        </header>

        {recs.length > 0 && (
          <div className="hc-ip-meter" aria-hidden="true">
            {recs.map((r) => (
              <i key={r.id} className={applied.has(r.id) ? "is-applied" : skipped.has(r.id) ? "is-skipped" : ""} />
            ))}
          </div>
        )}

        <ul className="hc-ip-groups">
          {groups.map(({ gap, recs: groupRecs }) => {
            const open = openGap === gap.id;
            const done = groupRecs.every((r) => applied.has(r.id));
            return (
              <li key={gap.id} className={`hc-ip-group${open ? " is-open" : ""}${done ? " is-done" : ""}`}>
                <button
                  type="button"
                  className="hc-ip-group-head"
                  aria-expanded={open}
                  onClick={() => setOpenGap(open ? null : gap.id)}
                >
                  <span className="hc-ip-chevron" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="hc-ip-group-title">
                    <strong>{gap.requirement}</strong>
                    <small>
                      Asked by {gap.jobs.length} job{gap.jobs.length === 1 ? "" : "s"}
                      {gap.importance === "must_have" ? " · must have" : ""}
                    </small>
                  </span>
                  <span className={`hc-ip-state${done ? " is-done" : ""}`}>
                    {done ? "✓ Applied" : `${groupRecs.length} change${groupRecs.length === 1 ? "" : "s"}`}
                  </span>
                </button>

                {open && (
                  <div className="hc-ip-group-body">
                    <div className="hc-ip-evidence">
                      <span className="hc-label">Why: the jobs say</span>
                      {gap.jobs.slice(0, 3).map((j) => (
                        <p key={j.jobId}>
                          <span>{j.company || "Job"}</span>“{j.jobQuote}”
                        </p>
                      ))}
                    </div>
                    {groupRecs.map((rec) => {
                      const isApplied = applied.has(rec.id);
                      return (
                        <div key={rec.id} className={`hc-ip-change${isApplied ? " is-applied" : ""}`}>
                          <div className="hc-ip-change-head">
                            <strong>{rec.label}</strong>
                            <button
                              type="button"
                              className={isApplied ? "hc-ip-undo" : "hc-button hc-ip-apply"}
                              onClick={() => onToggle(rec.id)}
                            >
                              {isApplied ? "Undo" : "Apply"}
                            </button>
                          </div>
                          <Diff before={rec.before} after={rec.after} />
                          <p className="hc-ip-why">{rec.explanation}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {recommendations !== null && unanswered.length > 0 && (
          <div className="hc-ip-unanswered">
            <span className="hc-label">For your recruiter call</span>
            <p>Your resume has no proof for these yet, so your agent won’t invent it.</p>
            <ul>
              {unanswered.map((g) => (
                <li key={g.id}>
                  {g.requirement}
                  <small> · asked by {g.jobs.length} job{g.jobs.length === 1 ? "" : "s"}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </aside>
  );
}
