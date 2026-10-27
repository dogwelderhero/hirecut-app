"use client";

/**
 * The journey workspace: the persistent shell around the scenario's screens.
 *
 * The shell — transcript, stepper, stage error, footer — stays mounted for the
 * whole run; only the screen inside it changes. Which screen shows which
 * stage, how stages group into visible steps, and which results dwell and pack
 * all come from the run's flow (web/scenarios/<id>.json), so the two journeys
 * share this file without branching on the scenario.
 *
 * Rules (02-screen-guide.md §2):
 *  - Left: the agent's actions, one at a time, grouped by step; finished steps
 *    collapse into a receipt. Right: the live outcome of the step on screen.
 *  - Packing results stay on screen for the foreground dwell, pack into their
 *    receipt, then the next screen shows. Nobody presses Next.
 *  - Timers only animate. Work, results and counts come from the run.
 */

import { useCallback, useMemo, useState } from "react";
import type { JobId, StageId } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import { nextStageOf, screenOf, type Flow } from "@/lib/hirecute/flow.mjs";
import type { LetterMap } from "@/lib/hirecute/letters";
import type { RunState } from "@/lib/hirecute/run-store";
import { AgentTranscript, type LocalStep, type StageReceipt } from "./agent-transcript";
import { StageProgress } from "./stage-progress";
import { useReducedMotion } from "./workspace/common";
import { SCREENS } from "./workspace/screens";
import type { JourneyActions, ShellApi } from "./workspace/types";
import { usePresentation } from "./workspace/use-presentation";

export function Workspace({
  flow,
  runState,
  publicConfig,
  fileName,
  letters,
  onLettersChange,
  onSelectionChange,
  onSaveLetter,
  onAcceptResume,
  onRestart,
}: {
  flow: Flow;
  runState: RunState;
  publicConfig: PublicConfig;
  fileName: string | null;
  letters: LetterMap;
  onLettersChange: (next: LetterMap) => void;
  onSelectionChange: (ids: JobId[]) => void;
  onSaveLetter: (id: JobId) => void;
  onAcceptResume: (appliedRecommendationIds: string[], excludedItems: string[]) => Promise<boolean>;
  onRestart: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const { presentation, shownStage } = usePresentation(flow, runState, reducedMotion);

  // What a screen tells the shell: its browser-side step, and a modal.
  const [localStep, setLocalStepState] = useState<LocalStep | null>(null);
  const [inert, setInertState] = useState(false);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const setLocalStep = useCallback((step: LocalStep | null) => setLocalStepState(step), []);
  const setInert = useCallback((on: boolean) => setInertState(on), []);
  const shell: ShellApi = useMemo(() => ({ setLocalStep, setInert, overlayRoot }), [setLocalStep, setInert, overlayRoot]);

  const actions: JourneyActions = { letters, onLettersChange, onSelectionChange, onSaveLetter, onAcceptResume, onRestart };

  const screenId = screenOf(flow, shownStage);
  const Screen = SCREENS[screenId]?.Screen;

  // Receipts: each completed stage's, written by the screen that presented it.
  const receipts: StageReceipt[] = [];
  for (const stage of flow.stages) {
    const make = SCREENS[flow.screens[stage] ?? ""]?.receipts?.[stage];
    const receipt = make?.({ runState, presentation });
    if (receipt) receipts.push(receipt);
  }

  const nextStage: StageId | null =
    shownStage && runState.stages[shownStage]?.status === "completed" ? nextStageOf(flow, shownStage) : null;

  const stageError = runState.stages[shownStage ?? flow.stages[0]]?.error ?? runState.terminalError ?? null;

  return (
    <>
      <div className={`hc-shell hc-shell--conversation${inert ? " hc-credit-background" : ""}`} inert={inert}>
        <AgentTranscript
          steps={flow.steps}
          fileName={fileName}
          actions={runState.actions}
          receipts={receipts}
          queued={runState.lifecycle === "queued"}
          liveStage={runState.liveStage}
          nextStage={nextStage}
          localStep={localStep}
        />

        <main className="hc-main" data-hc-zone="main_work_area">
          <StageProgress
            steps={flow.steps}
            stages={runState.stages}
            visible={shownStage ?? flow.stages[0]}
            localActive={localStep !== null}
          />

          <section className="hc-work">
            {stageError && (
              <div className="hc-panel hc-danger-panel" role="alert">
                <p>{stageError.message}</p>
              </div>
            )}

            {Screen && (
              <Screen
                flow={flow}
                runState={runState}
                presentation={presentation}
                shownStage={shownStage}
                publicConfig={publicConfig}
                reducedMotion={reducedMotion}
                actions={actions}
                shell={shell}
              />
            )}
          </section>

          <footer className="hc-work-footer">
            <span>hirecute · your job search, with a little help</span>
            <button type="button" className="hc-button hc-button--quiet" onClick={onRestart}>
              <span>Start over</span>
            </button>
          </footer>
        </main>
      </div>

      {/* Modals portal here: the shell's sibling, outside the inert subtree. */}
      <div ref={setOverlayRoot} style={{ display: "contents" }} />
    </>
  );
}
