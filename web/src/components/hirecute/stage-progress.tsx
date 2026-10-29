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
 * press Next. Once the run has finished, a finished step is a button that shows
 * its result again (never forward into work that has not happened).
 */

import { Fragment } from "react";
import type { StageId, StageState } from "@/lib/hirecute/contracts";
import type { FlowStep } from "@/lib/hirecute/flow.mjs";

/**
 * Visible steps come from the scenario's flow: a step may span stages (finding
 * and scoring jobs are one step in the recruiter journey), and a `local` step
 * has no backend stage — it is active once the screen says so.
 */
export function StageProgress({
  steps,
  stages,
  visible,
  localActive = false,
  onSelect,
}: {
  steps: readonly FlowStep[];
  stages: Record<StageId, StageState | null>;
  /** The stage the visitor is looking at — may lag the worker during a dwell. */
  visible: StageId | null;
  /** The flow's local step is on (e.g. the recruiters are showing). */
  localActive?: boolean;
  /** Which steps can be opened, by index; absent while work is running. */
  onSelect?: { can: (index: number) => boolean; select: (index: number) => void };
}) {
  return (
    <nav className="hc-stepper" aria-label="Progress" data-hc-zone="step_navigation">
      {steps.map((step, i) => {
        const isLocalStep = step.stages.length === 0;
        const statuses = step.stages.map((s) => stages[s]?.status ?? "pending");
        const done = !isLocalStep && statuses.every((s) => s === "completed");
        const failed = statuses.some((s) => s === "failed" || s === "interrupted");
        const active = isLocalStep
          ? localActive
          : !localActive && visible !== null && step.stages.includes(visible);
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
            {onSelect?.can(i) ? (
              <button
                type="button"
                className={`hc-step is-selectable ${state}`.trim()}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect.select(i)}
              >
                <b>{done ? "✓" : i + 1}</b>
                <span className="hc-step-name">{step.title}</span>
              </button>
            ) : (
              <div className={`hc-step ${state}`.trim()} aria-current={active ? "step" : undefined}>
                {/* `.hc-step b` is the numbered circle. */}
                <b>{done ? "✓" : i + 1}</b>
                <span className="hc-step-name">{step.title}</span>
              </div>
            )}
            {i < steps.length - 1 && <span className="hc-step-line" aria-hidden />}
          </Fragment>
        );
      })}
    </nav>
  );
}
