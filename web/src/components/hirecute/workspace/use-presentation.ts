"use client";

import { useEffect, useReducer, useRef } from "react";
import type { StageId } from "@/lib/hirecute/contracts";
import type { Flow } from "@/lib/hirecute/flow.mjs";
import {
  initialPresentationState,
  presentationReducer,
  visibleStage,
  type PresentationState,
} from "@/lib/hirecute/presentation";
import { completedStages, type RunState } from "@/lib/hirecute/run-store";

/**
 * The presentation clock for one run, under the scenario's rules (which
 * results dwell and pack, which have no screen of their own).
 *
 * Work events and presentation timing are separate clocks (02-screen-guide.md
 * §2): the worker may finish a stage while the visitor still reads an earlier
 * result. Hidden tabs pause the dwell; backend work carries on.
 */
export function usePresentation(
  flow: Flow,
  runState: RunState,
  reducedMotion: boolean,
): { presentation: PresentationState; shownStage: StageId | null } {
  // A run that already did work when this page met it (a refresh, a second
  // tab, the same resume sent again) is RESTORED: its finished stages count as
  // presented and the visitor lands where the run is, instead of watching
  // every result replay. Done in the initializer so the first paint is right.
  const runId = runState.snapshot?.id ?? null;
  const restoredFor = useRef<string | null>(runId);
  const [presentation, dispatch] = useReducer(presentationReducer, undefined, () =>
    presentationReducer(
      initialPresentationState({ reducedMotion, rules: { packing: flow.packing, absorbed: flow.absorbed } }),
      restoreAction(flow, runState),
    ),
  );

  useEffect(() => {
    dispatch({ type: "reduced_motion", reducedMotion });
  }, [reducedMotion]);

  // Each durable stage result is queued for presentation exactly once. A
  // different run arriving later (the pending upload becoming real) is
  // restored first, so only stages finishing from here on animate.
  const doneKey = completedStages(runState).join(",");
  useEffect(() => {
    if (runId && restoredFor.current !== runId) {
      restoredFor.current = runId;
      dispatch(restoreAction(flow, runState));
    }
    for (const stage of doneKey ? (doneKey.split(",") as StageId[]) : []) {
      dispatch({ type: "stage_result", stage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runState is read only for this run's restore
  }, [doneKey, runId]);

  useEffect(() => {
    const onVisibility = () => dispatch({ type: "visibility", foreground: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => {
    const step = 100;
    const id = setInterval(() => dispatch({ type: "tick", deltaMs: step }), step);
    return () => clearInterval(id);
  }, []);

  return { presentation, shownStage: visibleStage(presentation, runState.liveStage) };
}

/**
 * Mark the run's finished stages presented. If the last finished stage does not
 * pack (bulk apply, improve), it stays on screen as settled; otherwise the
 * live stage shows.
 */
function restoreAction(flow: Flow, runState: RunState) {
  const done = completedStages(runState).filter((s) => flow.stages.includes(s));
  const last = [...flow.stages].reverse().find((s) => done.includes(s));
  const settledStage = last && !flow.packing.includes(last) ? last : undefined;
  return { type: "restore" as const, presentedStages: done, settledStage };
}
