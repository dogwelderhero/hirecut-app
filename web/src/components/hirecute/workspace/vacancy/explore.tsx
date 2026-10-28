"use client";

import { exploreReceipt } from "@/lib/hirecute/actions";
import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";
import { isDwelling, isPacking } from "@/lib/hirecute/presentation";
import { ExploreResults } from "../../search-results";
import { PackingStatus, StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { stageActions, useJobView } from "./shared";
import { QueryVisual, SourceRows, WorkingPanel } from "./working-panel";

/** Screen 05 — Explore Jobs. */
function Explore({ runState, presentation, shell }: ScreenProps) {
  const explore = runState.stages.explore?.result;
  const jobView = useJobView(shell.view);
  return (
    <section className="hc-agent-stage">
      {explore?.kind !== "explore" ? (
        <div className="hc-stage-working">
          <StageHeading
            step="02"
            name="Explore Jobs"
            title="Let’s see what’s out there."
            lead="Searching for roles that fit your experience and the way you want to work."
            /* The real number of boards, not the reference's "4 sources". */
            pill={`Searching ${CURATED_BOARDS.length} boards`}
          />
          <WorkingPanel
            visual={<QueryVisual preferences={runState.snapshot?.preferences ?? null} />}
            title="A wider search. A tighter fit."
            lead="Your agent reads each board's own postings, removes duplicates and drops listings it cannot date."
            actions={stageActions(runState, "explore")}
            aside={<SourceRows />}
            footer="Your search preferences are applied to every source."
          />
        </div>
      ) : (
        <div className={`hc-stage-result${isPacking(presentation, "explore") ? " is-packing" : ""}`}>
          <ExploreResults
            jobs={runState.jobs}
            order={runState.jobOrder}
            assessments={runState.assessments}
            savedIds={jobView.savedIds}
            expandedId={jobView.expandedId}
            onToggleSave={jobView.toggleSave}
            onToggleExpand={jobView.toggleExpand}
            coverage={explore.coverage}
            preferences={runState.snapshot?.preferences ?? null}
          />
        </div>
      )}
      {isPacking(presentation, "explore") && <PackingStatus />}
    </section>
  );
}

export const exploreScreen: ScreenModule = {
  Screen: Explore,
  receipts: {
    explore: ({ runState, presentation }) => {
      const explore = runState.stages.explore?.result;
      if (explore?.kind !== "explore" || isDwelling(presentation, "explore")) return null;
      return {
        stage: "explore",
        label: `${explore.jobIds.length} roles saved`,
        detail: exploreReceipt(explore.jobIds.length, explore.coverage.boardsFailed).replace(/^\d+ roles? saved · /, ""),
      };
    },
  },
};
