import type { JobId, StageId } from "@/lib/hirecute/contracts";
import type { RunState } from "@/lib/hirecute/run-store";
import type { ViewStore } from "../types";

/** A stage's actions as the working panel's checklist shows them. */
export function stageActions(runState: RunState, stage: StageId) {
  return runState.actions.filter((a) => a.stage === stage).map((a) => ({ label: a.label, status: a.status }));
}

/**
 * Saved and expanded jobs are shared by Explore and Top Matches (a job saved on
 * one is still saved on the other), so they live in the shell's view store.
 */
export function useJobView(view: ViewStore) {
  const savedIds = new Set(view.get<JobId[]>("vacancy.saved", []));
  const expandedId = view.get<JobId | null>("vacancy.expanded", null);
  return {
    savedIds,
    expandedId,
    toggleSave: (id: JobId) =>
      view.set<JobId[]>("vacancy.saved", (prev = []) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    toggleExpand: (id: JobId) => view.set<JobId | null>("vacancy.expanded", (prev) => (prev === id ? null : id)),
  };
}
