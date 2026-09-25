/**
 * Typed operator configuration and pilot limits.
 *
 * Names here are hirecute's own (see 04-coding-agent-brief.md "Operator
 * configuration"); they are NOT pre-existing career-ops variables. Nothing in
 * this module is read by the browser except `publicConfig()`.
 *
 * Reading config never throws at import time: a missing model or Stripe
 * credential must not block local implementation or fixture tests, it only
 * blocks the corresponding real integration. Call `assertModelConfigured()` /
 * `assertBillingConfigured()` at the point of real use instead.
 */

import type { LaunchProfile } from "./contracts";

function str(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name);
  if (v === null) return fallback;
  return v === "true" || v === "1";
}

/**
 * Pilot limits and presentation timings.
 *
 * The values live in `limits.mjs` so the journey worker can read a budget
 * without type stripping; this module re-exports them for the typed side.
 * Tunable by an operator by editing that file — deliberately not a settings UI.
 */
export { LIMITS, PRESENTATION } from "@/lib/hirecute/limits.mjs";
import { LIMITS as LIMIT_VALUES, PRESENTATION as PRESENTATION_VALUES } from "@/lib/hirecute/limits.mjs";

export interface ServerConfig {
  /** Absolute path to the pinned immutable career-ops checkout. */
  codeRoot: string;
  /** Absolute writable dir for sessions/runs/cache/billing. Never under public/. */
  dataDir: string;
  /** Canonical same-origin public URL. */
  baseUrl: string;
  model: {
    baseUrl: string | null;
    apiKey: string | null;
    model: string | null;
  };
  /** Default false. Enabling requires an installed, tested SubmitAdapter. */
  submissionEnabled: boolean;
  stripe: {
    secretKey: string | null;
    publishableKey: string | null;
    webhookSecret: string | null;
  };
}

export function serverConfig(): ServerConfig {
  return {
    // Defaults resolve to this checkout so local development works with no env
    // file; a real deployment sets both explicitly.
    codeRoot: str("HIRECUTE_CODE_ROOT") ?? process.cwd().replace(/\/web$/, ""),
    dataDir: str("HIRECUTE_DATA_DIR") ?? `${process.cwd().replace(/\/web$/, "")}/var/hirecute`,
    baseUrl: str("HIRECUTE_BASE_URL") ?? "http://localhost:3100",
    model: {
      baseUrl: str("HIRECUTE_MODEL_API_BASE_URL"),
      apiKey: str("HIRECUTE_MODEL_API_KEY"),
      model: str("HIRECUTE_MODEL"),
    },
    submissionEnabled: bool("HIRECUTE_SUBMISSION_ENABLED", false),
    stripe: {
      secretKey: str("STRIPE_SECRET_KEY"),
      publishableKey: str("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
      webhookSecret: str("STRIPE_WEBHOOK_SECRET"),
    },
  };
}

/**
 * The launch profile is derived, never hand-set: promising auto-apply requires
 * an actually enabled adapter. See 01-architecture.md §1 "The auto-apply
 * decision cannot be hidden in implementation".
 */
export function launchProfile(cfg: ServerConfig = serverConfig()): LaunchProfile {
  return cfg.submissionEnabled ? "auto_apply_pilot" : "activation_pilot";
}

/** Fields the browser is allowed to see. No secrets, no paths. */
export interface PublicConfig {
  launchProfile: LaunchProfile;
  /** The only payment key exposed to the client. */
  stripePublishableKey: string | null;
  billingMode: "test" | "live";
  maxUploadBytes: number;
  maxSelectedPackages: number;
  presentation: typeof PRESENTATION_VALUES;
}

export function publicConfig(cfg: ServerConfig = serverConfig()): PublicConfig {
  const key = cfg.stripe.publishableKey;
  return {
    launchProfile: launchProfile(cfg),
    stripePublishableKey: key,
    // Mode is read off the key prefix so the UI cannot be told it is live by a
    // client flag. A missing key reads as test.
    billingMode: key?.startsWith("pk_live_") ? "live" : "test",
    maxUploadBytes: LIMIT_VALUES.maxUploadBytes,
    maxSelectedPackages: LIMIT_VALUES.maxSelectedPackages,
    presentation: PRESENTATION_VALUES,
  };
}

export class ConfigurationError extends Error {
  // An explicit field, not a TS parameter property: Node's strip-only type
  // stripping (which `npm test` relies on) cannot transform those.
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`hirecute is missing operator configuration: ${missing.join(", ")}`);
    this.name = "ConfigurationError";
    this.missing = missing;
  }
}

/** Call before a REAL model request, not at import time. */
export function assertModelConfigured(cfg: ServerConfig = serverConfig()): void {
  const missing = [
    !cfg.model.baseUrl && "HIRECUTE_MODEL_API_BASE_URL",
    !cfg.model.apiKey && "HIRECUTE_MODEL_API_KEY",
    !cfg.model.model && "HIRECUTE_MODEL",
  ].filter(Boolean) as string[];
  if (missing.length) throw new ConfigurationError(missing);
}

/** Call before a REAL Stripe request, not at import time. */
export function assertBillingConfigured(cfg: ServerConfig = serverConfig()): void {
  const missing = [
    !cfg.stripe.secretKey && "STRIPE_SECRET_KEY",
    !cfg.stripe.publishableKey && "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  ].filter(Boolean) as string[];
  if (missing.length) throw new ConfigurationError(missing);
  const secretLive = cfg.stripe.secretKey!.startsWith("sk_live_");
  const publishableLive = cfg.stripe.publishableKey!.startsWith("pk_live_");
  if (secretLive !== publishableLive) {
    throw new ConfigurationError(["STRIPE key mode mismatch (secret vs publishable)"]);
  }
}
