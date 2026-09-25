"use client";

/**
 * The four-step progress line — `nav.hc-stepper`.
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
import { STAGE_ORDER } from "@/lib/hirecute/screens";

const STAGE_TITLES: Record<StageId, string> = {
  refine: "Finetune Resume",
  explore: "Explore Jobs",
  match: "Top matching jobs",
  prepare: "Bulk Apply",
};

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
      {STAGE_ORDER.map((stage, i) => {
        const status = stages[stage]?.status ?? "pending";
        const done = status === "completed";
        const failed = status === "failed" || status === "interrupted";
        const active = visible === stage;
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
          <Fragment key={stage}>
            <div className={`hc-step ${state}`.trim()} aria-current={active ? "step" : undefined}>
              {/* `.hc-step b` is the numbered circle. */}
              <b>{done ? "✓" : i + 1}</b>
              <span className="hc-step-name">{STAGE_TITLES[stage]}</span>
            </div>
            {i < STAGE_ORDER.length - 1 && <span className="hc-step-line" aria-hidden />}
          </Fragment>
        );
      })}
    </nav>
  );
}
