/**
 * Which scenario a NEW run gets. Server-only.
 *
 * The rules live in scenarios.mjs (`resolveScenario`, pure and tested); this
 * file only supplies their inputs on the server: the deployment's enabled
 * scenarios (validated once per process — the env cannot change under a
 * running server) and the visitor's sticky cookie. The landing page's query
 * parameter is read where the visitor first arrives, not here: a POST that
 * creates a run carries no query.
 */

import { cookies } from "next/headers";
import { serverConfig } from "@/lib/hirecute/config";
import {
  COOKIE,
  checkDeploymentScenarios,
  resolveScenario,
  type DeploymentScenarios,
  type ScenarioReason,
} from "@/lib/hirecute/scenarios.mjs";

export interface ScenarioChoice {
  id: string;
  version: number;
  reason: ScenarioReason;
}

export class ScenarioConfigError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`hirecute scenario configuration is invalid: ${errors.join("; ")}`);
    this.name = "ScenarioConfigError";
    this.errors = errors;
  }
}

let deployment: Promise<DeploymentScenarios> | null = null;

export function deploymentScenarios(): Promise<DeploymentScenarios> {
  deployment ??= checkDeploymentScenarios(serverConfig().codeRoot, process.env);
  return deployment;
}

export async function chooseScenario(): Promise<ScenarioChoice> {
  const d = await deploymentScenarios();
  if (!d.ok) throw new ScenarioConfigError(d.errors);
  const jar = await cookies();
  const pick = resolveScenario({ value: null, cookie: jar.get(COOKIE)?.value ?? null, entries: d.entries });
  return { id: pick.id, version: d.scenarios[pick.id].version, reason: pick.reason };
}
