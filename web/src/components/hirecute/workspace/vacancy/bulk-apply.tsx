"use client";

import { useEffect, useMemo, useState } from "react";
import { prepareReceipt } from "@/lib/hirecute/actions";
import type { JobId } from "@/lib/hirecute/contracts";
import { editLetter } from "@/lib/hirecute/letters";
import { rankByScore } from "@/lib/hirecute/match";
import { selectedJobIds, type RunState } from "@/lib/hirecute/run-store";
import { BulkApply } from "../../bulk-apply";
import type { ScreenModule, ScreenProps } from "../types";

/** Jobs this stage covers: the prepared batch once it exists, the selection before. */
function batchJobIdsOf(runState: RunState): JobId[] {
  const prepare = runState.stages.prepare?.result;
  return prepare?.kind === "prepare"
    ? [...prepare.preparedJobIds, ...prepare.blockedJobIds, ...prepare.failedJobIds]
    : selectedJobIds(runState);
}

/** Screen 09 — Bulk Apply. Stays mounted when preparation finishes: no pack, no dim, no navigation. */
function BulkApplyScreen({ runState, publicConfig, actions, shell }: ScreenProps) {
  const selected = selectedJobIds(runState);
  const batchJobIds = batchJobIdsOf(runState);

  const ranked = useMemo(() => {
    const withScores = runState.jobOrder.map((id) => ({ jobId: id, score5: runState.assessments[id]?.score5 ?? null }));
    return rankByScore(withScores).map((r) => r.jobId);
  }, [runState.jobOrder, runState.assessments]);

  /*
    The reference's Bulk Apply screen opens with the first row of the batch
    already selected and its letter showing on the right — never the empty
    "Select a role" placeholder: the single best-scored job when the batch
    holds it, otherwise the batch's own first row.
  */
  const [activeJobId, setActiveJobId] = useState<JobId | null>(() =>
    ranked[0] && batchJobIds.includes(ranked[0]) ? ranked[0] : (batchJobIds[0] ?? ranked[0] ?? null),
  );
  useEffect(() => {
    if (!activeJobId && ranked.length > 0) setActiveJobId(ranked[0]);
  }, [activeJobId, ranked]);
  const batchKey = batchJobIds.join(",");
  useEffect(() => {
    const ids = batchKey ? batchKey.split(",") : [];
    if (ids.length === 0) return;
    if (activeJobId && ids.includes(activeJobId)) return;
    setActiveJobId(ids[0] as JobId);
  }, [batchKey, activeJobId]);

  return (
    <section className="hc-agent-stage hc-application-stage">
      <div className="hc-stage-result">
        <div className="hc-application-preview">
          <header className="hc-sr-heading">
            <div>
              <div className="hc-sr-eyebrow">STEP 04 · BULK APPLY</div>
              <h1>Your next move, made personal.</h1>
              <p>Tailored applications. Personal introductions. Your agent is putting it all together.</p>
            </div>
            <div className="hc-sr-complete">
              <i />
              <span>
                {runState.stages.prepare?.status === "running" ? "Preparing your applications" : "Ready for your approval"}
              </span>
            </div>
          </header>
        </div>
        <BulkApply
          /*
            Only roles this stage actually covers. Ranking produces every
            discovered job, but prepare works the selected batch — listing all
            of them left thirty rows reading "Preparing application…" for work
            that was never queued.
          */
          jobs={batchJobIds.map((id) => runState.jobs[id]).filter(Boolean)}
          applications={runState.applications}
          assessments={runState.assessments}
          selectedIds={selected}
          activeJobId={activeJobId}
          letters={actions.letters}
          launchProfile={publicConfig.launchProfile}
          preparing={runState.stages.prepare?.status === "running"}
          onSelectJob={setActiveJobId}
          onToggleInclude={(id, included) =>
            actions.onSelectionChange(included ? [...new Set([...selected, id])] : selected.filter((s) => s !== id))
          }
          onEditLetter={(id, text) => actions.onLettersChange(editLetter(actions.letters, id, text))}
          onSaveLetter={actions.onSaveLetter}
          onClaimCredits={() => shell.claimCredits?.()}
        />
      </div>
    </section>
  );
}

export const bulkApplyScreen: ScreenModule = {
  Screen: BulkApplyScreen,
  receipts: {
    // Marked complete WITHOUT a packing animation (§7).
    prepare: ({ runState }) => {
      const prepare = runState.stages.prepare?.result;
      return prepare?.kind === "prepare"
        ? { stage: "prepare", label: prepareReceipt(prepare.preparedJobIds.length, prepare.blockedJobIds.length) }
        : null;
    },
  },
};
