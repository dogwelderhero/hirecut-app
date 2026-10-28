import { headers } from "next/headers";
import { publicConfig, serverConfig } from "@/lib/hirecute/config";
import { loadLandingContent } from "@/lib/hirecute/landing-content.mjs";
import { SCENARIO_HEADER } from "@/lib/hirecute/landing-router.mjs";
import { deploymentScenarios } from "@/lib/hirecute/scenario-choice";
import { loadFlows } from "@/lib/hirecute/scenarios.mjs";
import { HirecuteJourney } from "@/components/hirecute/journey";

/**
 * The hirecute product route (route group `(hirecute)` → `/`).
 *
 * Only public configuration crosses to the client: no paths, no secrets, and
 * the Stripe *publishable* key only. `launchProfile` is derived server-side
 * from whether a submission adapter is actually enabled, so the browser cannot
 * be told the product auto-applies when it does not — the landing's
 * launch-profile variants are resolved here, before anything is sent.
 *
 * The landing is the visitor's scenario's: proxy.ts routed the request and
 * passed the scenario in a request header (never visible to the browser).
 */
export default async function HirecutePage() {
  const config = publicConfig();
  const fromRouter = (await headers()).get(SCENARIO_HEADER);
  const routed = fromRouter ? (JSON.parse(fromRouter) as { scenario: string; reason: string }) : null;
  const scenario = routed?.scenario ?? (await fallbackScenario());
  const landing = await loadLandingContent(serverConfig().codeRoot, scenario, {
    launchProfile: config.launchProfile,
  });
  const enabled = (await deploymentScenarios()).entries.map((e) => e.id);
  const flows = await loadFlows(serverConfig().codeRoot, [...new Set([...enabled, scenario])]);
  // A `?t=` link names the journey explicitly; it wins over a run of another one.
  const requested = routed?.reason === "param" ? scenario : null;
  return <HirecuteJourney publicConfig={config} landing={landing} flows={flows} requestedScenario={requested} />;
}

/**
 * Only reached when the router could not decide (a scenario env changed under
 * a running server; preflight refuses to boot with one that is broken): show
 * the first enabled scenario rather than no page.
 */
async function fallbackScenario(): Promise<string> {
  const d = await deploymentScenarios();
  return d.entries[0]?.id ?? Object.keys(d.scenarios)[0] ?? "recruiter";
}
