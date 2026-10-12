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
 * Visible steps. Finetune and Explore run in parallel on one screen, so they
 * are one step: done when both are, failed if either is.
 */
const STEPS: ReadonlyArray<{ stages: StageId[]; title: string }> = [
  { stages: ["refine", "explore"], title: "Resume & jobs" },
  { stages: ["match"], title: "Top matching jobs" },
  { stages: ["prepare"], title: "Bulk Apply" },
];

export function StageProgress({
  stages,
  visible,
}: {
  stages: Record<StageId, StageState | null>;
  /** The stage the visitor is looking at — may lag the worker during a dwell. */
  visible: StageId | null;
}) {
  return (
    <nav className="hc-stepper" aria-label="Progress">
      {STEPS.map((step, i) => {
        const statuses = step.stages.map((s) => stages[s]?.status ?? "pending");
        const done = statuses.every((s) => s === "completed");
        const failed = statuses.some((s) => s === "failed" || s === "interrupted");
        const active = visible !== null && step.stages.includes(visible);
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
