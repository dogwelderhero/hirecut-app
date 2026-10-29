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
 *  - Once every stage has finished, a finished step (stepper or receipt) shows
 *    its result again over the current screen, which stays mounted underneath.
 *    While work is running there is no going back.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { JobId, StageId } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import { nextStageOf, screenOf, type Flow } from "@/lib/hirecute/flow.mjs";
import type { LetterMap } from "@/lib/hirecute/letters";
import { isPacking } from "@/lib/hirecute/presentation";
import type { RunState } from "@/lib/hirecute/run-store";
import { AgentTranscript, type LocalStep, type StageReceipt } from "./agent-transcript";
import { StageProgress } from "./stage-progress";
import { useReducedMotion } from "./workspace/common";
import { useCreditsCheckout } from "./workspace/credits-checkout";
import { SCREENS } from "./workspace/screens";
import type { JourneyActions, ShellApi } from "./workspace/types";
import { useViewStore } from "./workspace/view-store";
import { usePresentation } from "./workspace/use-presentation";
import { useResultFlight } from "./workspace/use-result-flight";

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
  const receiving = useResultFlight(presentation, reducedMotion);

  // What a screen tells the shell: its browser-side step, and a modal.
  const [localStep, setLocalStepState] = useState<LocalStep | null>(null);
  const [inert, setInertState] = useState(false);
  const [overlayRoot, setOverlayRoot] = useState<HTMLDivElement | null>(null);
  const setLocalStep = useCallback((step: LocalStep | null) => setLocalStepState(step), []);
  const setInert = useCallback((on: boolean) => setInertState(on), []);
  // Per-run state that survives a refresh: decisions on the server, view in sessionStorage.
  const view = useViewStore(runState.snapshot?.id ?? null, runState.snapshot?.decisions);

  const actions: JourneyActions = { letters, onLettersChange, onSelectionChange, onSaveLetter, onAcceptResume, onRestart };

  const screenId = screenOf(flow, shownStage);
  const Screen = SCREENS[screenId]?.Screen;

  // A finished step shown again. Only once the whole run has finished and the
  // last result is on screen: never while work runs or a result is packing.
  const [reviewStage, setReviewStage] = useState<StageId | null>(null);
  const finished =
    flow.stages.every((s) => runState.stages[s]?.status === "completed") && shownStage === flow.stages.at(-1);
  const reviewing = finished ? reviewStage : null;
  const reviewScreenId = reviewing ? screenOf(flow, reviewing) : null;
  const ReviewScreen = reviewScreenId ? SCREENS[reviewScreenId]?.Screen : undefined;
  const shownScreenId = reviewScreenId ?? screenId;
  useEffect(() => {
    if (finished) window.scrollTo({ top: 0, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of the step viewed scrolls
  }, [reviewing]);

  // Shell features the flow switches on (the vacancy journey's credits checkout).
  const credits = useCreditsCheckout({
    config: flow.shell?.credits,
    view,
    runState,
    // The screen the visitor sees: a step viewed again is not Bulk Apply's counter.
    screenId: shownScreenId,
    publicConfig,
    reducedMotion,
  });
  const shell: ShellApi = useMemo(
    () => ({ setLocalStep, setInert, overlayRoot, view, claimCredits: credits?.claim }),
    [setLocalStep, setInert, overlayRoot, view, credits?.claim],
  );
  const shellInert = inert || Boolean(credits?.open);

  /** Show a finished stage again, or come back (null). */
  const review = useCallback(
    (stage: StageId | null) => {
      if (stage === null) return setReviewStage(null);
      // The stage's screen is the current one: the screen shows it itself.
      if (screenOf(flow, stage) === screenId) {
        setReviewStage(null);
        SCREENS[screenId]?.onReview?.(stage, shell);
        return;
      }
      setReviewStage(stage);
    },
    [flow, screenId, shell],
  );
  // A step opens at its last stage, once the run has finished.
  const stepStage = (i: number): StageId | null => flow.steps[i]?.stages.at(-1) ?? null;
  // The browser-side step (the recruiters) has no stage: it is reachable again
  // once the visitor has been there, through the screen that owns it.
  const localReached = view.get<boolean>("shell.localReached", false);
  useEffect(() => {
    if (localStep && !localReached) view.set("shell.localReached", true);
  }, [localStep, localReached, view]);
  const isLocal = (i: number) => Boolean(flow.steps[i]?.local);
  const stepper = finished
    ? {
        can: (i: number) => {
          const stages = flow.steps[i].stages;
          // The local step: to come back to it, or to reopen it from the step before.
          if (isLocal(i)) return localReached && (reviewing !== null || localStep === null);
          if (!stepStage(i)) return false;
          // The step being viewed again is not a button; the current one is, to come back.
          if (reviewing) return !stages.includes(reviewing);
          // The current step, unless a browser-side step (the recruiters) has taken over from it.
          return localStep !== null || shownStage === null || !stages.includes(shownStage);
        },
        select: (i: number) => {
          if (isLocal(i)) {
            setReviewStage(null);
            if (!localStep) SCREENS[screenId]?.onLocalStep?.(shell);
            return;
          }
          const stage = stepStage(i);
          if (stage && reviewing !== null && screenOf(flow, stage) === screenId) return review(null);
          review(stage);
        },
      }
    : undefined;

  // Receipts: each completed stage's, written by the screen that presented it.
  const receipts: StageReceipt[] = [];
  for (const stage of flow.stages) {
    const make = SCREENS[flow.screens[stage] ?? ""]?.receipts?.[stage];
    const receipt = make?.({ runState, presentation });
    if (!receipt) continue;
    // While its result packs, the receipt waits (dashed) for it to land.
    const state = isPacking(presentation, stage) ? "awaiting" : receiving === stage ? "receiving" : undefined;
    const onOpen = finished ? () => review(stage) : undefined;
    receipts.push({ ...receipt, ...(state ? { state } : {}), ...(onOpen ? { onOpen } : {}) });
  }

  const nextStage: StageId | null =
    shownStage && runState.stages[shownStage]?.status === "completed" ? nextStageOf(flow, shownStage) : null;

  const stageError = runState.stages[shownStage ?? flow.stages[0]]?.error ?? runState.terminalError ?? null;

  return (
    <>
      {/*
        While a modal is open the real shell takes `hc-credit-background` (fixed,
        blurred, pointer-events:none) and `inert`; the modal stays a sibling,
        since a CSS filter would blur anything nested in here.
      */}
      <div className={`hc-shell hc-shell--conversation${shellInert ? " hc-credit-background" : ""}`} inert={shellInert}>
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

        {/* Main work area — the only zone the credits counter listens to. */}
        <main className="hc-main" data-hc-zone="main_work_area" onClick={credits?.onMainClick}>
          {/* The reference puts the credits banner first in `main`, above the stepper. */}
          {credits?.banner}

          <StageProgress
            steps={flow.steps}
            stages={runState.stages}
            visible={reviewing ?? shownStage ?? flow.stages[0]}
            localActive={!reviewing && localStep !== null}
            onSelect={stepper}
          />

          <section className="hc-work">
            {stageError && (
              <div className="hc-panel hc-danger-panel" role="alert">
                <p>{stageError.message}</p>
                {flow.shell?.retryButton && stageError.retryable && (
                  <button type="button" className="hc-button hc-button--quiet">
                    <span>Try that step again</span>
                  </button>
                )}
              </div>
            )}

            {reviewing && ReviewScreen && (
              <>
                <div className="hc-review-bar" role="status" data-hc-zone="step_navigation">
                  <span>
                    Viewing step {flow.steps.findIndex((s) => s.stages.includes(reviewing)) + 1}:{" "}
                    {flow.steps.find((s) => s.stages.includes(reviewing))?.title}
                  </span>
                  <button type="button" className="hc-button hc-button--quiet" onClick={() => review(null)}>
                    <span>Back to current step</span>
                  </button>
                </div>
                <div className="hc-screen" key={`review-${reviewScreenId}`}>
                  <ReviewScreen
                    flow={flow}
                    runState={runState}
                    presentation={presentation}
                    shownStage={reviewing}
                    publicConfig={publicConfig}
                    reducedMotion={reducedMotion}
                    fileName={fileName}
                    actions={actions}
                    shell={shell}
                  />
                </div>
              </>
            )}

            {/*
              Keyed by screen: a new screen fades in rather than popping over the
              last. Hidden, not unmounted, while a finished step is viewed again,
              so its own state is there on the way back.
            */}
            {Screen && (
              <div className="hc-screen" key={screenId} hidden={Boolean(reviewing && ReviewScreen)}>
                <Screen
                  flow={flow}
                  runState={runState}
                  presentation={presentation}
                  shownStage={shownStage}
                  publicConfig={publicConfig}
                  reducedMotion={reducedMotion}
                  fileName={fileName}
                  actions={actions}
                  shell={shell}
                />
              </div>
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

      {credits?.overlay}

      {/* Screen modals portal here: the shell's sibling, outside the inert subtree. */}
      <div ref={setOverlayRoot} style={{ display: "contents" }} />
    </>
  );
}
