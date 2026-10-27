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
  ATTR_COOKIE,
  STICKY_MAX_AGE_S,
  runAttribution,
  type Attribution,
} from "@/lib/hirecute/landing-router.mjs";
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
  reason: ScenarioReason | string;
  attribution: Attribution;
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
  // The landing already assigned (and logged) the scenario; when the run gets
  // that same one, its attribution says how. A run created without a landing
  // (direct API call, expired cookie) is attributed to what happened here.
  const attribution: Attribution =
    pick.reason === "sticky"
      ? runAttribution(jar.get(ATTR_COOKIE)?.value, pick.id)
      : { scenario: pick.id, reason: pick.reason };
  if (pick.reason !== "sticky") {
    // No landing assigned this browser (or its scenario was switched off):
    // pin what it got here, the way the landing would have.
    jar.set(COOKIE, pick.id, {
      maxAge: STICKY_MAX_AGE_S,
      httpOnly: true,
      sameSite: "lax",
      secure: serverConfig().baseUrl.startsWith("https:"),
      path: "/",
    });
  }
  return { id: pick.id, version: d.scenarios[pick.id].version, reason: attribution.reason, attribution };
}
