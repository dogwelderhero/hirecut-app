/** Types for `scenarios.mjs`. */
export const STAGE_SLOTS: readonly string[];
export const BUILTIN_SERVICES: readonly string[];
export const NAMED_SERVICES: readonly string[];
export const REQUIREMENTS: readonly string[];
export const COOKIE: string;

export interface ScenarioEntry {
  id: string;
  weight: number;
}
export type ScenarioReason = "param" | "sticky" | "split" | "param-unknown" | "sticky-disabled";

export function scenariosDir(codeRoot: string): string;
export function stepsDir(codeRoot: string): string;
export function parseScenariosEnv(
  value: string | undefined,
): { ok: true; entries: ScenarioEntry[] } | { ok: false; error: string };
export function scenarioParam(env: Record<string, string | undefined>): string | null;
export function resolveScenario(opts: {
  value?: string | null;
  cookie?: string | null;
  entries: ScenarioEntry[];
  random?: () => number;
}): { id: string; reason: ScenarioReason };

export interface DeploymentScenarios {
  ok: boolean;
  param: string | null;
  entries: ScenarioEntry[];
  errors: string[];
  scenarios: Record<string, { version: number; resultStage: string; steps: string[]; requires: string[] }>;
}
export function loadFlows(codeRoot: string, ids: string[]): Promise<Record<string, import("./flow.mjs").Flow>>;
export function checkDeploymentScenarios(
  codeRoot: string,
  env: Record<string, string | undefined>,
): Promise<DeploymentScenarios>;
