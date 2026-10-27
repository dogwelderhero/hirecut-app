"use client";

import { matchReceipt } from "@/lib/hirecute/actions";
import { matchPresentation } from "@/lib/hirecute/match";
import { isDwelling, isPacking } from "@/lib/hirecute/presentation";
import { MatchResults } from "../../search-results";
import { PackingStatus, StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { stageActions, useJobView } from "./shared";
import { CountRingVisual, WorkingPanel } from "./working-panel";

/** Screen 07 — Top matching jobs. */
function Matches({ runState, presentation, shell }: ScreenProps) {
  const match = runState.stages.match?.result;
  const jobView = useJobView(shell.view);
  return (
    <section className="hc-agent-stage">
      {match?.kind !== "match" ? (
        <div className="hc-stage-working">
          <StageHeading
            step="03"
            name="Top matching jobs"
            title="Looking for your kind of role."
            lead="Comparing every opening with your skills, experience and priorities."
            pill="Matching in progress"
          />
          <WorkingPanel
            visual={
              <CountRingVisual
                /* The real number of discovered roles being compared. */
                count={runState.jobOrder.length > 0 ? runState.jobOrder.length : null}
                caption="Roles being compared"
                note="One shortlist built around you."
                tags={["Experience", "Skills", "Preferences"]}
              />
            }
            title="More than a keyword match."
            lead="Your agent looks at what you’ve actually done, what the role asks for, and what you want next."
            actions={stageActions(runState, "match")}
            footer="Every match comes with a reason."
          />
        </div>
      ) : (
        <div className={`hc-stage-result${isPacking(presentation, "match") ? " is-packing" : ""}`}>
          <MatchResults
            jobs={runState.jobs}
            order={runState.jobOrder}
            rankedIds={match.rankedJobIds}
            assessments={runState.assessments}
            savedIds={jobView.savedIds}
            expandedId={jobView.expandedId}
            onToggleSave={jobView.toggleSave}
            onToggleExpand={jobView.toggleExpand}
          />
          {/* §6: the percentage is a profile match, not a probability. */}
          <p className="hc-match-legend">{matchPresentation({ score5: 5 })?.explanation}</p>
        </div>
      )}
      {isPacking(presentation, "match") && <PackingStatus />}
    </section>
  );
}

export const matchesScreen: ScreenModule = {
  Screen: Matches,
  receipts: {
    match: ({ runState, presentation }) => {
      const match = runState.stages.match?.result;
      if (match?.kind !== "match" || isDwelling(presentation, "match")) return null;
      return {
        stage: "match",
        label: `${match.rankedJobIds.length} top matches saved`,
        detail: matchReceipt(match.rankedJobIds.length).replace(/^.*saved · /, ""),
      };
    },
  },
};
