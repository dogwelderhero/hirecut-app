"use client";

import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";
import { isDwelling, isPacking } from "@/lib/hirecute/presentation";
import { JobsLive } from "../../jobs-live";
import { PackingStatus, StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { gapsOf } from "./derived";

/** Step 2 — Finding jobs & gaps: jobs stream in, get scored, gaps collect live. */
function JobsGaps({ runState, presentation }: ScreenProps) {
  const explore = runState.stages.explore?.result;
  const match = runState.stages.match?.result;
  const searching = runState.stages.explore?.status === "running" || runState.liveStage === "explore";
  const scoring = runState.stages.match?.status === "running";
  return (
    <section className="hc-agent-stage">
      <StageHeading
        step="02"
        name="Finding jobs & gaps"
        title={match?.kind === "match" ? "Here’s where you stand." : "Finding jobs that fit you."}
        lead={
          searching
            ? "Your agent is checking company career pages for roles that fit your experience."
            : "Your agent reads every job and quotes what it asks for, next to what your resume shows."
        }
        pill={match?.kind === "match" ? "Jobs scored" : searching ? "Searching" : "Reading jobs"}
      />
      <div className={`hc-stage-result${isPacking(presentation, "match") ? " is-packing" : ""}`}>
        <JobsLive
          jobs={runState.jobs}
          order={explore?.kind === "explore" ? explore.jobIds : runState.jobOrder}
          assessments={runState.assessments}
          searching={searching}
          scoring={scoring}
          boardCount={CURATED_BOARDS.length}
          error={runState.stages.explore?.error ?? null}
        />
      </div>
      {isPacking(presentation, "match") && <PackingStatus />}
    </section>
  );
}

export const jobsGapsScreen: ScreenModule = {
  Screen: JobsGaps,
  receipts: {
    match: ({ runState, presentation }) => {
      const match = runState.stages.match?.result;
      if (match?.kind !== "match" || isDwelling(presentation, "match")) return null;
      const explore = runState.stages.explore?.result;
      const jobCount = explore?.kind === "explore" ? explore.jobIds.length : runState.jobOrder.length;
      const scoredCount = Object.keys(runState.assessments).length;
      const gaps = gapsOf(runState);
      return {
        stage: "match",
        label: `${scoredCount} of ${jobCount} jobs scored`,
        detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} found · Quotes included`,
      };
    },
  },
};
