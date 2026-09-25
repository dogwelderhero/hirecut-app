/**
 * Server-side projection: apply one public event to the run snapshot.
 *
 * `GET /runs/current` is what a refresh and a reconnect restore from, so the
 * snapshot has to be a complete materialization of the log — not just a
 * sequence counter. Without this, a run could finish with 94 events on disk and
 * still restore an empty workspace.
 *
 * This is deliberately the mirror of the browser's `run-store.ts` reducer, and
 * it is called INSIDE `appendEvent` under the same write lock, so the snapshot
 * and the log can never disagree about what has happened.
 */

import type { EventPayloadMap, RunSnapshot, StageId } from "./contracts";

type Applied = { [K in keyof EventPayloadMap]: { type: K; payload: EventPayloadMap[K] } }[keyof EventPayloadMap];

export function projectEvent(snapshot: RunSnapshot, event: Applied): RunSnapshot {
  const s = snapshot;

  switch (event.type) {
    case "run.started":
      return { ...s, status: "running", currentStage: event.payload.stage };

    case "stage.started": {
      const stage = event.payload.stage;
      return {
        ...s,
        status: "running",
        currentStage: stage,
        stages: {
          ...s.stages,
          [stage]: {
            ...s.stages[stage],
            status: "running",
            inputVersion: event.payload.inputVersion,
            attempt: event.payload.attempt,
            error: null,
          },
        },
      };
    }

    case "action.started": {
      const action = event.payload.action;
      const stage = action.stage;
      // Idempotent by action id, so a replayed message cannot duplicate a row.
      if (s.stages[stage].actions.some((a) => a.id === action.id)) return s;
      return {
        ...s,
        stages: {
          ...s.stages,
          [stage]: { ...s.stages[stage], actions: [...s.stages[stage].actions, action] },
        },
      };
    }

    case "action.completed":
    case "action.error": {
      const stage = event.payload.stage;
      const isError = event.type === "action.error";
      return {
        ...s,
        stages: {
          ...s.stages,
          [stage]: {
            ...s.stages[stage],
            actions: s.stages[stage].actions.map((a) =>
              a.id === event.payload.actionId
                ? {
                    ...a,
                    status: isError ? "failed" : "completed",
                    completedAt: new Date().toISOString(),
                    error: isError ? event.payload.error : a.error,
                  }
                : a,
            ),
          },
        },
      };
    }

    case "job.discovered": {
      const job = event.payload.job;
      const index = s.jobs.findIndex((j) => j.id === job.id);
      // Upsert in place: re-discovery updates the row, it does not add a card.
      const jobs = index === -1 ? [...s.jobs, job] : s.jobs.map((j) => (j.id === job.id ? job : j));
      return { ...s, jobs };
    }

    case "job.evaluated": {
      const a = event.payload.assessment;
      const index = s.assessments.findIndex((x) => x.jobId === a.jobId);
      const assessments =
        index === -1 ? [...s.assessments, a] : s.assessments.map((x) => (x.jobId === a.jobId ? a : x));
      return { ...s, assessments };
    }

    case "stage.result": {
      const { stage, result, inputVersion } = event.payload;
      // The contract requires result.kind === stage; a worker that disagrees is
      // not trusted to have completed the stage.
      if (result.kind !== stage) return s;
      let next: RunSnapshot = {
        ...s,
        stages: {
          ...s.stages,
          [stage]: { ...s.stages[stage], status: "completed", result, inputVersion, error: null },
        },
      };
      if (result.kind === "match") {
        // Merge, so an incrementally-evaluated job is not dropped.
        const byId = new Map(next.assessments.map((a) => [a.jobId, a]));
        for (const a of result.assessments) byId.set(a.jobId, a);
        next = { ...next, assessments: [...byId.values()] };
      }
      return next;
    }

    case "stage.error":
      return {
        ...s,
        stages: {
          ...s.stages,
          [event.payload.stage]: {
            ...s.stages[event.payload.stage],
            status: "failed",
            error: event.payload.error,
          },
        },
      };

    case "application.updated": {
      const app = event.payload.application;
      const prev = s.applications.find((a) => a.jobId === app.jobId);
      // A stale package write must not clobber a newer one.
      if (prev && prev.version > app.version) return s;
      const applications = prev
        ? s.applications.map((a) => (a.jobId === app.jobId ? app : a))
        : [...s.applications, app];
      return { ...s, applications };
    }

    case "selection.updated": {
      const selection = event.payload.selection;
      if (s.selection.version > selection.version) return s;
      return { ...s, selection };
    }

    case "letter.completed": {
      const { jobId, revision } = event.payload;
      return {
        ...s,
        applications: s.applications.map((a) =>
          a.jobId === jobId ? { ...a, letter: { status: "ready", current: revision } } : a,
        ),
      };
    }

    case "letter.error": {
      const { jobId, error } = event.payload;
      return {
        ...s,
        applications: s.applications.map((a) =>
          a.jobId === jobId
            ? { ...a, letter: { status: "failed", current: a.letter.current, error } }
            : a,
        ),
      };
    }

    // letter.started / letter.delta are STREAM-only. Persisting every chunk
    // would rewrite run.json hundreds of times per letter, and the committed
    // text arrives with letter.completed anyway. A reconnecting client gets the
    // finished draft from the snapshot rather than a half-streamed one.
    case "letter.started":
    case "letter.delta":
    case "keepalive":
      return s;

    case "billing.updated":
      return { ...s, billing: event.payload.billing };

    case "credits.granted":
      return {
        ...s,
        billing: {
          ...s.billing,
          status: "activated",
          promotionalCredit: event.payload.grant,
          entitlement: event.payload.entitlement,
        },
      };

    case "submission.updated":
      return {
        ...s,
        applications: s.applications.map((a) =>
          a.jobId === event.payload.jobId ? { ...a, submission: event.payload.state } : a,
        ),
      };

    case "run.queued":
      return { ...s, status: "queued" };

    case "run.done":
      return { ...s, status: "preparation_complete" };

    case "run.interrupted": {
      const stage = event.payload.stage as StageId;
      const current = s.stages[stage];
      // A run-level interruption must not rewrite a stage that already
      // COMPLETED or FAILED with its own reason. Overwriting a finished
      // explore with "interrupted" loses the fact that its jobs are real.
      const rewritable = current.status !== "completed" && current.status !== "failed";
      return {
        ...s,
        status: "interrupted",
        stages: rewritable
          ? { ...s.stages, [stage]: { ...current, status: "interrupted" } }
          : s.stages,
      };
    }

    case "run.error":
      return { ...s, status: "failed" };

    case "run.cancelled":
      return { ...s, status: "cancelled" };

    default:
      return s;
  }
}
