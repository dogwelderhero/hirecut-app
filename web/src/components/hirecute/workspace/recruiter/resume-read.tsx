"use client";

import { isDwelling, isPacking } from "@/lib/hirecute/presentation";
import { ResumeReview } from "../../resume-review";
import { PackingStatus, StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { resumeOf } from "./derived";

/** Step 1 — Reading your resume: sections load in place, nothing is changed yet. */
function ResumeRead({ runState, presentation }: ScreenProps) {
  const refine = runState.stages.refine?.result;
  const resume = resumeOf(runState);
  return (
    <section className="hc-agent-stage">
      <StageHeading
        step="01"
        name="Reading your resume"
        title={resume ? "Your experience, mapped." : "Reading your resume."}
        lead={
          resume
            ? "Every section and role is mapped. Next, your agent finds jobs that fit."
            : "Your agent is mapping every section and role. Nothing is changed at this step."
        }
        pill={refine?.kind === "refine" ? "Resume read" : "Agent is working"}
      />
      <div className={`hc-stage-result hc-step-single${isPacking(presentation, "refine") ? " is-packing" : ""}`}>
        <ResumeReview
          phase="read"
          resume={resume}
          recommendations={[]}
          recommendationsAvailable
          appliedIds={[]}
          excludedItems={[]}
          locked
          onToggleRecommendation={() => {}}
          onToggleItem={() => {}}
          readProgress={runState.resumeProgress}
        />
      </div>
      {isPacking(presentation, "refine") && <PackingStatus />}
    </section>
  );
}

export const resumeReadScreen: ScreenModule = {
  Screen: ResumeRead,
  receipts: {
    refine: ({ runState, presentation }) =>
      runState.stages.refine?.result?.kind === "refine" && !isDwelling(presentation, "refine")
        ? { stage: "refine", label: "Resume read", detail: "Every section mapped · Original kept" }
        : null,
  },
};
