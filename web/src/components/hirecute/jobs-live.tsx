"use client";

/**
 * Step 2 — Finding jobs & gaps.
 *
 * Every real posting as a Flowkit role card (`hc-sr-card` +
 * match panel), scored as each assessment lands. "See the evidence" opens its
 * requirements: met / partly / missing, each with the posting's own line and
 * the resume's own line (both verified verbatim by the worker). Each card
 * carries its own gap count; the merged gaps are step 3's job.
 *
 * Honesty rules:
 *  - Only discovered postings; a count is the number of rows shown.
 *  - A match percentage appears only once that role has actually been scored.
 *  - Quotes are shown only when the worker verified them; nothing is paraphrased
 *    into quote marks here.
 */

import { useRef, useState } from "react";
import type { Job, JobId, MatchAssessment, PublicError } from "@/lib/hirecute/contracts";
import { matchPresentation } from "@/lib/hirecute/match";
import { JobCard } from "./job-card";
import { useListMotion } from "./use-list-motion";
import { useReducedMotion } from "./workspace/common";

export function JobsLive({
  jobs,
  order,
  assessments,
  searching,
  scoring,
  boardCount,
  error,
}: {
  jobs: Record<JobId, Job>;
  order: JobId[];
  assessments: Record<JobId, MatchAssessment>;
  /** Discovery is still running. */
  searching: boolean;
  /** Scoring is running: unscored cards say they are being read. */
  scoring: boolean;
  boardCount: number;
  error: PublicError | null;
}) {
  const [openId, setOpenId] = useState<JobId | null>(null);
  // Jobs re-sort as scores land: slide them, and play an entrance only once.
  const feed = useRef<HTMLDivElement>(null);
  useListMotion(feed, useReducedMotion());

  const ids = order.filter((id) => jobs[id]);
  const scored = ids
    .filter((id) => matchPresentation(assessments[id]))
    .sort((a, b) => assessments[b].score5 - assessments[a].score5);
  const rows = [...scored, ...ids.filter((id) => !matchPresentation(assessments[id]))];

  const status = searching
    ? rows.length > 0
      ? `${rows.length} found so far · still searching`
      : `Checking ${boardCount} company career pages…`
    : scoring
      ? `${scored.length} of ${rows.length} jobs read`
      : `${rows.length} jobs · ${scored.length} read and scored`;

  return (
    <div className="hc-jl">
      <div className="hc-jl-status">
        <span className="hc-label">Jobs for your resume</span>
        <span className="hc-tag">
          {(searching || scoring) && <i className="hc-rz-pulse" aria-hidden="true" />}
          {status}
        </span>
      </div>

      <div ref={feed} className="hc-sr-feed hc-jl-cards" aria-label="Jobs for your resume" aria-live="polite">
        {rows.map((id) => (
          <JobCard
            key={id}
            job={jobs[id]}
            assessment={assessments[id] ?? null}
            showMatchPanel
            pending={scoring && !assessments[id]}
            motionId={id}
            expanded={openId === id}
            onToggleExpand={() => setOpenId((cur) => (cur === id ? null : id))}
          />
        ))}
        {rows.length === 0 && (
          <p className="hc-jl-empty">
            {error ? error.message : `Checking ${boardCount} company career pages. Jobs appear here as they are found.`}
          </p>
        )}
      </div>
    </div>
  );
}
