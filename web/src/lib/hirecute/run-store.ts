/**
 * The run store: a reducer over the public NDJSON event protocol.
 *
 * 02-screen-guide.md §2: "Events update a run store; components select the part
 * they need. Do not implement each screen as a new independent fetch that
 * launches the same worker again."
 *
 * Correctness rules encoded here:
 *  - `seq` is monotonic per run. Anything `<= lastSequence` is a replay and is
 *    dropped, so a reconnect cannot duplicate a transcript row.
 *  - There is no `stage.done`. `stage.result` is the only terminal success for
 *    a stage, and a stream that simply ends is `interrupted`, not success.
 *  - Actions are appended as they *start*. The future action list is never
 *    revealed up front.
 *  - Only allowlisted payload fields reach the UI. No raw model text.
 */

import type {
  ActionProgress,
  ApplicationPackage,
  ApplicationSelection,
  BillingPublicState,
  Job,
  JobId,
  MatchAssessment,
  PublicError,
  PublicRunEvent,
  RunSnapshot,
  Sequence,
  StageId,
  StageState,
} from "./contracts";
import { STAGE_ORDER } from "@/lib/hirecute/screens";
import {
  emptyLetter,
  letterCompleted,
  letterDelta,
  letterErrored,
  letterStarted,
  type LetterMap,
} from "@/lib/hirecute/letters";

export type RunLifecycle =
  | "absent"
  | "queued"
  | "running"
  | "done"
  | "interrupted"
  | "error"
  | "cancelled";

export interface RunState {
  snapshot: RunSnapshot | null;
  lastSequence: Sequence;
  lifecycle: RunLifecycle;
  queuePosition: number | null;
  /** The stage the WORKER is on. Presentation may still be showing an earlier one. */
  liveStage: StageId | null;
  stages: Record<StageId, StageState | null>;
  /** Chronological transcript, in the order actions started. */
  actions: ActionProgress[];
  jobs: Record<JobId, Job>;
  /** Discovery order, so a card cannot move because an object key was reordered. */
  jobOrder: JobId[];
  assessments: Record<JobId, MatchAssessment>;
  rankedJobIds: JobId[];
  applications: Record<JobId, ApplicationPackage>;
  selection: ApplicationSelection | null;
  letters: LetterMap;
  billing: BillingPublicState | null;
  terminalError: PublicError | null;
}

export function initialRunState(): RunState {
  return {
    snapshot: null,
    lastSequence: 0,
    lifecycle: "absent",
    queuePosition: null,
    liveStage: null,
    stages: { refine: null, explore: null, match: null, prepare: null },
    actions: [],
    jobs: {},
    jobOrder: [],
    assessments: {},
    rankedJobIds: [],
    applications: {},
    selection: null,
    letters: {},
    billing: null,
    terminalError: null,
  };
}

function withStage(
  state: RunState,
  stage: StageId,
  patch: Partial<StageState>,
): Record<StageId, StageState | null> {
  const prev: StageState =
    state.stages[stage] ??
    {
      stage,
      status: "pending",
      inputVersion: 0,
      inputHash: "",
      attempt: 0,
      actions: [],
      result: null,
      error: null,
    };
  return { ...state.stages, [stage]: { ...prev, ...patch } };
}

/** Apply one event. Returns the same object when the event is a replay/no-op. */
export function applyEvent(state: RunState, event: PublicRunEvent): RunState {
  // Replay protection. seq is monotonic within a run.
  if (event.seq <= state.lastSequence) return state;
  const base = { ...state, lastSequence: event.seq };

  switch (event.type) {
    case "run.queued":
      return { ...base, lifecycle: "queued", queuePosition: event.payload.queuePosition };

    case "run.started":
      return {
        ...base,
        lifecycle: "running",
        queuePosition: null,
        liveStage: event.payload.stage,
      };

    case "stage.started":
      return {
        ...base,
        lifecycle: "running",
        liveStage: event.payload.stage,
        stages: withStage(base, event.payload.stage, {
          status: "running",
          inputVersion: event.payload.inputVersion,
          attempt: event.payload.attempt,
          error: null,
        }),
      };

    case "action.started": {
      const action = event.payload.action;
      if (base.actions.some((a) => a.id === action.id)) return base;
      return { ...base, actions: [...base.actions, action] };
    }

    case "action.completed":
      return {
        ...base,
        actions: base.actions.map((a) =>
          a.id === event.payload.actionId
            ? { ...a, status: "completed", completedAt: event.time }
            : a,
        ),
      };

    case "action.error":
      // A failed action keeps the completed rows above it (§2 "errors retain
      // completed rows").
      return {
        ...base,
        actions: base.actions.map((a) =>
          a.id === event.payload.actionId
            ? { ...a, status: "failed", completedAt: event.time, error: event.payload.error }
            : a,
        ),
      };

    case "job.discovered": {
      const job = event.payload.job;
      const known = job.id in base.jobs;
      return {
        ...base,
        jobs: { ...base.jobs, [job.id]: job },
        jobOrder: known ? base.jobOrder : [...base.jobOrder, job.id],
      };
    }

    case "job.evaluated": {
      const a = event.payload.assessment;
      return { ...base, assessments: { ...base.assessments, [a.jobId]: a } };
    }

    case "stage.result": {
      const { stage, result, inputVersion } = event.payload;
      // Runtime guard: the contract requires result.kind === stage. A worker
      // that disagrees is not trusted to have completed the stage.
      if (result.kind !== stage) return base;
      let next: RunState = {
        ...base,
        stages: withStage(base, stage, {
          status: "completed",
          result,
          inputVersion,
          error: null,
        }),
      };
      if (result.kind === "match") {
        next = {
          ...next,
          rankedJobIds: result.rankedJobIds,
          assessments: result.assessments.reduce(
            (acc, a) => ({ ...acc, [a.jobId]: a }),
            next.assessments,
          ),
        };
      }
      return next;
    }

    case "stage.error":
      return {
        ...base,
        stages: withStage(base, event.payload.stage, {
          status: "failed",
          error: event.payload.error,
        }),
      };

    case "application.updated": {
      const app = event.payload.application;
      const prev = base.applications[app.jobId];
      // Version guard: a stale package write must not clobber a newer one.
      if (prev && prev.version > app.version) return base;
      return {
        ...base,
        applications: { ...base.applications, [app.jobId]: app },
        letters: base.letters[app.jobId]
          ? base.letters
          : { ...base.letters, [app.jobId]: emptyLetter(app.jobId) },
      };
    }

    case "selection.updated": {
      const sel = event.payload.selection;
      if (base.selection && base.selection.version > sel.version) return base;
      return { ...base, selection: sel };
    }

    case "letter.started":
      return {
        ...base,
        letters: letterStarted(base.letters, event.payload.jobId, event.payload.generationId),
      };

    case "letter.delta":
      return {
        ...base,
        letters: letterDelta(
          base.letters,
          event.payload.jobId,
          event.payload.generationId,
          event.payload.text,
        ),
      };

    case "letter.completed":
      return {
        ...base,
        letters: letterCompleted(
          base.letters,
          event.payload.jobId,
          event.payload.generationId,
          event.payload.revision,
        ),
      };

    case "letter.error":
      return {
        ...base,
        letters: letterErrored(
          base.letters,
          event.payload.jobId,
          event.payload.generationId,
          event.payload.error,
        ),
      };

    case "billing.updated":
      return { ...base, billing: event.payload.billing };

    case "credits.granted":
      // Authoritative entitlement. Never inferred from a CTA click.
      return {
        ...base,
        billing: base.billing
          ? {
              ...base.billing,
              status: "activated",
              promotionalCredit: event.payload.grant,
              entitlement: event.payload.entitlement,
            }
          : base.billing,
      };

    case "submission.updated": {
      const prev = base.applications[event.payload.jobId];
      if (!prev) return base;
      return {
        ...base,
        applications: {
          ...base.applications,
          [event.payload.jobId]: { ...prev, submission: event.payload.state },
        },
      };
    }

    case "run.done":
      // Preparation finished. Bulk Apply stays mounted — see presentation.ts.
      return { ...base, lifecycle: "done" };

    case "run.interrupted":
      return {
        ...base,
        lifecycle: "interrupted",
        stages: withStage(base, event.payload.stage, { status: "interrupted" }),
      };

    case "run.error":
      return { ...base, lifecycle: "error", terminalError: event.payload.error };

    case "run.cancelled":
      return { ...base, lifecycle: "cancelled" };

    case "keepalive":
      // Connection health only. Explicitly not task completion.
      return base;
  }
}

export function applyEvents(state: RunState, events: PublicRunEvent[]): RunState {
  return events.reduce(applyEvent, state);
}

/** Rehydrate from `GET /api/hirecute/runs/current` before replaying events. */
const SNAPSHOT_STATUS_TO_LIFECYCLE: Record<RunSnapshot["status"], RunLifecycle> = {
  queued: "queued",
  running: "running",
  preparation_complete: "done",
  failed: "error",
  interrupted: "interrupted",
  cancelled: "cancelled",
};

export function restoreSnapshot(snapshot: RunSnapshot): RunState {
  const state = initialRunState();
  const matchResult = snapshot.stages.match?.result;
  return {
    ...state,
    snapshot,
    lastSequence: snapshot.lastSequence,
    lifecycle: SNAPSHOT_STATUS_TO_LIFECYCLE[snapshot.status],
    liveStage: snapshot.currentStage,
    stages: snapshot.stages,
    actions: STAGE_ORDER.flatMap((s) => snapshot.stages[s]?.actions ?? []),
    jobs: snapshot.jobs.reduce((acc, j) => ({ ...acc, [j.id]: j }), {}),
    jobOrder: snapshot.jobs.map((j) => j.id),
    assessments: snapshot.assessments.reduce((acc, a) => ({ ...acc, [a.jobId]: a }), {}),
    // rankedJobIds lives in the match stage result, not on the snapshot root.
    rankedJobIds: matchResult?.kind === "match" ? matchResult.rankedJobIds : [],
    applications: snapshot.applications.reduce((acc, a) => ({ ...acc, [a.jobId]: a }), {}),
    selection: snapshot.selection,
    letters: snapshot.applications.reduce<LetterMap>((acc, a) => {
      const current = a.letter.current;
      acc[a.jobId] = current
        ? { ...emptyLetter(a.jobId), receivedText: current.text, serverVersion: current.version }
        : emptyLetter(a.jobId);
      return acc;
    }, {}),
    billing: snapshot.billing,
  };
}

/**
 * Stream EOF is not success (§2). Only an explicit terminal record completes a
 * run; anything else that stops mid-flight is interrupted and retryable.
 */
export function lifecycleOnStreamEnd(state: RunState): RunLifecycle {
  if (state.lifecycle === "running" || state.lifecycle === "queued") return "interrupted";
  return state.lifecycle;
}

/** Stages presented so far — feeds `presentationReducer`'s restore action. */
export function completedStages(state: RunState): StageId[] {
  return STAGE_ORDER.filter((s) => state.stages[s]?.status === "completed");
}

export function selectedJobIds(state: RunState): JobId[] {
  return state.selection?.jobIds ?? [];
}
