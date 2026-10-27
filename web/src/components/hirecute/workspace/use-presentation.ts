"use client";

import { useEffect, useReducer } from "react";
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
  const [presentation, dispatch] = useReducer(presentationReducer, undefined, () =>
    initialPresentationState({ reducedMotion, rules: { packing: flow.packing, absorbed: flow.absorbed } }),
  );

  useEffect(() => {
    dispatch({ type: "reduced_motion", reducedMotion });
  }, [reducedMotion]);

  // Each durable stage result is queued for presentation exactly once.
  const doneKey = completedStages(runState).join(",");
  useEffect(() => {
    for (const stage of doneKey ? (doneKey.split(",") as StageId[]) : []) {
      dispatch({ type: "stage_result", stage });
    }
  }, [doneKey]);

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
