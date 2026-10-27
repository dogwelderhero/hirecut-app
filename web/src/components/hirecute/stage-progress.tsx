"use client";

/**
 * The progress line — `nav.hc-stepper`.
 *
 * Ported from the reference shell: `div.hc-step` (with `is-active`) holding a
 * number and `span.hc-step-name`, separated by `span.hc-step-line`.
 *
 * There are deliberately no advance controls here. §1 forbids reintroducing
 * "Preview what's next", "Explore jobs now", "See my best matches" or "Preview
 * applications now" — successful work continues without asking the visitor to
 * press Next.
 */

import { Fragment } from "react";
import type { StageId, StageState } from "@/lib/hirecute/contracts";
/**
 * Visible steps. Finding and scoring jobs are one step (2). Step 4, the
 * recruiters, has no backend stage: it is active once step 3 is done.
 */
const STEPS: ReadonlyArray<{ stages: StageId[]; title: string }> = [
  { stages: ["refine"], title: "Reading your resume" },
  { stages: ["explore", "match"], title: "Finding jobs & gaps" },
  { stages: ["improve"], title: "Improving your resume" },
  { stages: [], title: "Talk to a recruiter" },
];

export function StageProgress({
  stages,
  visible,
  recruiterActive = false,
}: {
  stages: Record<StageId, StageState | null>;
  /** The stage the visitor is looking at — may lag the worker during a dwell. */
  visible: StageId | null;
  /** Step 4 is on: the recruiters are showing. */
  recruiterActive?: boolean;
}) {
  return (
    <nav className="hc-stepper" aria-label="Progress">
      {STEPS.map((step, i) => {
        const isRecruiterStep = step.stages.length === 0;
        const statuses = step.stages.map((s) => stages[s]?.status ?? "pending");
        const done = !isRecruiterStep && statuses.every((s) => s === "completed");
        const failed = statuses.some((s) => s === "failed" || s === "interrupted");
        const active = isRecruiterStep
          ? recruiterActive
          : !recruiterActive && visible !== null && step.stages.includes(visible);
        const state = [
          active ? "is-active" : "",
          done ? "is-done" : "",
          failed ? "is-failed" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          // A Fragment, not a wrapper div: `.hc-stepper` is a flex row whose
          // direct children are the steps and the connecting lines, so an
          // extra element would break the layout.
          <Fragment key={step.title}>
            <div className={`hc-step ${state}`.trim()} aria-current={active ? "step" : undefined}>
              {/* `.hc-step b` is the numbered circle. */}
              <b>{done ? "✓" : i + 1}</b>
              <span className="hc-step-name">{step.title}</span>
            </div>
            {i < STEPS.length - 1 && <span className="hc-step-line" aria-hidden />}
          </Fragment>
        );
      })}
    </nav>
  );
}
