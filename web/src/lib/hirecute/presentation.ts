/**
 * The presentation state machine — deliberately separate from the run store.
 *
 * 02-screen-guide.md §2 "Work events versus presentation timing": the backend
 * may finish stage 3 while the UI is still dwelling on stage 1's result. Those
 * two clocks must not be the same clock, or a fast worker either skips a result
 * the visitor never saw or a slow animation looks like unfinished work.
 *
 * The rules encoded here:
 *  - refine / match results dwell 2000ms of FOREGROUND time, then pack into
 *    their conversation receipt over 780ms. explore has no screen of its own
 *    (its roles stream in beside the resume review), so its result is
 *    presented on arrival.
 *  - refine is GATED: its result stays on screen until the visitor presses
 *    "Accept changes". The dwell clock does not move it on by itself. Later
 *    results wait in the queue meanwhile; backend work is unaffected.
 *  - `prepare` never dwells, never packs, never navigates away. Bulk Apply
 *    stays mounted (brief: "Bulk Apply does not pack away or advance").
 *  - Hidden tab pauses the dwell; backend work continues. Elapsed foreground
 *    time is what counts, so a backgrounded tab cannot skip a result.
 *  - Reduced motion keeps the readable dwell and drops the spatial travel.
 *  - A refresh shows saved state; it must not replay fake work.
 */

import { PRESENTATION } from "@/lib/hirecute/config";
import type { StageId } from "./contracts";

/** Stages whose results get the dwell-and-pack choreography. */
export const PACKING_STAGES: readonly StageId[] = ["refine", "match"] as const;

/**
 * Stages with no result screen of their own. Explore's roles are shown live
 * beside the resume review, so its result is marked presented on arrival and
 * never queued — it cannot hold the view or delay the next screen.
 */
export const ABSORBED_STAGES: readonly StageId[] = ["explore"] as const;

export function stagePacks(stage: StageId): boolean {
  return PACKING_STAGES.includes(stage);
}

/** Stages whose result waits for an explicit accept instead of the dwell timer. */
export const GATED_STAGES: readonly StageId[] = ["refine"] as const;

export function stageIsGated(stage: StageId): boolean {
  return GATED_STAGES.includes(stage);
}

export type PresentationPhase =
  /** Nothing queued; the live stage renders its own working state. */
  | { kind: "idle" }
  /** Result visible in the workspace, accumulating foreground dwell time. */
  | { kind: "dwelling"; stage: StageId; elapsedMs: number }
  /** Result card travelling into its receipt. */
  | { kind: "packing"; stage: StageId; elapsedMs: number }
  /** Terminal for `prepare`: shown in place, never packed. */
  | { kind: "settled"; stage: StageId };

export interface PresentationState {
  phase: PresentationPhase;
  /**
   * Stage results that have arrived but not yet been presented, in arrival
   * order. A fast later stage waits here rather than overwriting the current
   * one.
   */
  queue: StageId[];
  /** Stages already fully presented — replay protection across reconnects. */
  presented: StageId[];
  foreground: boolean;
  reducedMotion: boolean;
  /** Gated stages the visitor has accepted. */
  accepted: StageId[];
}

export function initialPresentationState(
  opts: { foreground?: boolean; reducedMotion?: boolean; accepted?: StageId[] } = {},
): PresentationState {
  return {
    phase: { kind: "idle" },
    queue: [],
    presented: [],
    foreground: opts.foreground ?? true,
    reducedMotion: opts.reducedMotion ?? false,
    accepted: opts.accepted ?? [],
  };
}

export type PresentationAction =
  /** A durable `stage.result` arrived. Enqueue; never present synchronously. */
  | { type: "stage_result"; stage: StageId }
  /** Monotonic clock tick. `deltaMs` accrues only while foregrounded. */
  | { type: "tick"; deltaMs: number }
  | { type: "visibility"; foreground: boolean }
  /** The visitor accepted a gated stage's result; it may now pack away. */
  | { type: "accept"; stage: StageId }
  | { type: "reduced_motion"; reducedMotion: boolean }
  /** Refresh/reconnect: mark these stages presented without animating them. */
  | { type: "restore"; presentedStages: StageId[]; settledStage?: StageId }
  | { type: "reset" };

/** Effective pack duration — reduced motion drops the spatial travel. */
export function packDurationMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : PRESENTATION.packMs;
}

function startNext(state: PresentationState): PresentationState {
  const [next, ...rest] = state.queue;
  if (next === undefined) return { ...state, phase: { kind: "idle" } };

  // `prepare` has no dwell and no pack: it settles in place immediately.
  if (!stagePacks(next)) {
    return {
      ...state,
      queue: rest,
      phase: { kind: "settled", stage: next },
      presented: state.presented.includes(next) ? state.presented : [...state.presented, next],
    };
  }

  return { ...state, queue: rest, phase: { kind: "dwelling", stage: next, elapsedMs: 0 } };
}

/** End a dwell: pack, or — under reduced motion — present and move on. */
function leave(state: PresentationState, stage: StageId): PresentationState {
  if (packDurationMs(state.reducedMotion) === 0) {
    return startNext({ ...state, presented: [...state.presented, stage] });
  }
  return { ...state, phase: { kind: "packing", stage, elapsedMs: 0 } };
}

export function presentationReducer(
  state: PresentationState,
  action: PresentationAction,
): PresentationState {
  switch (action.type) {
    case "stage_result": {
      // Replay protection: a duplicated event after reconnect must not
      // re-present a result or duplicate its receipt.
      if (state.presented.includes(action.stage)) return state;
      if (state.queue.includes(action.stage)) return state;
      if (ABSORBED_STAGES.includes(action.stage)) {
        return { ...state, presented: [...state.presented, action.stage] };
      }
      const phase = state.phase;
      if ((phase.kind === "dwelling" || phase.kind === "packing") && phase.stage === action.stage) {
        return state;
      }
      const queued = { ...state, queue: [...state.queue, action.stage] };
      return phase.kind === "idle" || phase.kind === "settled" ? startNext(queued) : queued;
    }

    case "tick": {
      // Paused while hidden: the dwell measures foreground time, so a
      // backgrounded tab cannot silently burn through a result.
      if (!state.foreground) return state;
      const phase = state.phase;

      if (phase.kind === "dwelling") {
        const elapsedMs = phase.elapsedMs + action.deltaMs;
        // A gated result never times out: only "accept" moves it on.
        const holding = stageIsGated(phase.stage) && !state.accepted.includes(phase.stage);
        if (holding || elapsedMs < PRESENTATION.resultDwellMs) {
          return { ...state, phase: { ...phase, elapsedMs } };
        }
        return leave(state, phase.stage);
      }

      if (phase.kind === "packing") {
        const elapsedMs = phase.elapsedMs + action.deltaMs;
        if (elapsedMs < packDurationMs(state.reducedMotion)) {
          return { ...state, phase: { ...phase, elapsedMs } };
        }
        return startNext({ ...state, presented: [...state.presented, phase.stage] });
      }

      return state;
    }

    case "visibility":
      return { ...state, foreground: action.foreground };

    case "accept": {
      if (state.accepted.includes(action.stage)) return state;
      const accepted = { ...state, accepted: [...state.accepted, action.stage] };
      const phase = state.phase;
      // The click is the visitor's "I've read it" — no remaining dwell to wait out.
      if (phase.kind === "dwelling" && phase.stage === action.stage) {
        return leave(accepted, action.stage);
      }
      return accepted;
    }

    case "reduced_motion":
      return { ...state, reducedMotion: action.reducedMotion };

    case "restore": {
      const presented = [...new Set(action.presentedStages)];
      return {
        ...state,
        presented,
        queue: [],
        phase: action.settledStage
          ? { kind: "settled", stage: action.settledStage }
          : { kind: "idle" },
      };
    }

    case "reset":
      // A new journey asks again: acceptance belongs to the run, not the tab.
      return initialPresentationState({
        foreground: state.foreground,
        reducedMotion: state.reducedMotion,
      });
  }
}

/**
 * Which screen the workspace should render. Presentation can hold the view on
 * an earlier stage's result while the worker has already moved on — that is the
 * whole point of the separate machine.
 */
export function visibleStage(
  state: PresentationState,
  liveStage: StageId | null,
): StageId | null {
  const phase = state.phase;
  if (phase.kind === "dwelling" || phase.kind === "packing" || phase.kind === "settled") {
    return phase.stage;
  }
  return liveStage;
}

/**
 * True during the ~780ms packing animation only — the reference's
 * `div.hc-stage-save[role=status]` ("Result ready · Saving to your chat…")
 * and `.hc-stage-result.is-packing` fade both key off exactly this window,
 * not the whole dwell.
 */
export function isPacking(state: PresentationState, stage: StageId): boolean {
  const phase = state.phase;
  return phase.kind === "packing" && phase.stage === stage;
}

/** True while a result card is on screen (dwelling or travelling). */
export function isShowingResult(state: PresentationState, stage: StageId): boolean {
  const phase = state.phase;
  return (
    (phase.kind === "dwelling" || phase.kind === "packing" || phase.kind === "settled") &&
    phase.stage === stage
  );
}

/** True while a gated result is on screen waiting for the visitor to accept it. */
export function awaitingAcceptance(state: PresentationState, stage: StageId): boolean {
  const phase = state.phase;
  return (
    stageIsGated(stage) &&
    phase.kind === "dwelling" &&
    phase.stage === stage &&
    !state.accepted.includes(stage)
  );
}
