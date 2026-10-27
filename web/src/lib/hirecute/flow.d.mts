/** Types for `flow.mjs`. */
import type { StageId } from "./contracts";

export interface FlowStep {
  stages: StageId[];
  title: string;
  /** Runs in the browser, no backend stage (the recruiter step). */
  local?: boolean;
}

export interface Flow {
  stages: StageId[];
  steps: FlowStep[];
  screens: Partial<Record<StageId, string>>;
  /** Results that dwell, then pack into their receipt. */
  packing: StageId[];
  /** Stages with no result screen of their own; marked presented on arrival. */
  absorbed: StageId[];
}

export const SCREEN_IDS: readonly string[];
export function stepNumberOf(flow: Flow, stage: StageId): number | null;
export function screenOf(flow: Flow, stage: StageId | null): string;
export function nextStageOf(flow: Flow, stage: StageId): StageId | null;
export function validateFlow(id: string, flow: unknown, pipelineStages: string[]): string[];
