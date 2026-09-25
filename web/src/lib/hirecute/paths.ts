/**
 * The codeRoot / dataRoot split, and path containment.
 *
 * 01-architecture.md §2 is emphatic about this: `careerOpsRoot()` upstream
 * resolves ONE root and `rootScript()` joins script names onto it, so a
 * per-visitor data directory cannot be treated as a full checkout.
 *
 *   codeRoot  immutable pinned career-ops checkout — scripts, modes, templates
 *   dataRoot  ONE run's writable directory — originals, facts, drafts, outputs
 *
 * Rules encoded here:
 *  - Scripts are located under codeRoot only, and only from a fixed allowlist.
 *  - A child gets `CAREER_OPS_ROOT=dataRoot` AND an explicit
 *    `CAREER_OPS_TRACKER=<dataRoot>/data/applications.md`. The tracker override
 *    is not belt-and-braces: `generate-pdf.mjs` resolves its workspace root
 *    separately, and its tracker-cache refresh can otherwise fall back to the
 *    code checkout's tracker and reject the output.
 *  - The parent `process.env` is NEVER mutated per request.
 *  - No client-supplied path reaches the filesystem. Artifacts resolve by
 *    server-generated ID, then get a containment check.
 */

import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { serverConfig } from "@/lib/hirecute/config";

/** Scripts a worker is allowed to execute. Nothing else may be spawned. */
export const SCRIPT_ALLOWLIST = [
  "build-cv-html.mjs",
  "generate-pdf.mjs",
  "verify-cv-facts.mjs",
  "verify-ats.mjs",
  "fetch-jd.mjs",
  "scan.mjs",
] as const;

export type AllowedScript = (typeof SCRIPT_ALLOWLIST)[number];

export function codeRoot(): string {
  return path.resolve(serverConfig().codeRoot);
}

export function dataDir(): string {
  return path.resolve(serverConfig().dataDir);
}

/** Absolute path to an allowlisted script under codeRoot. */
export function scriptPath(name: AllowedScript): string {
  if (!SCRIPT_ALLOWLIST.includes(name)) {
    throw new Error(`hirecute: script not allowlisted: ${name}`);
  }
  return path.join(codeRoot(), name);
}

export function runDir(runId: string): string {
  // runId is server-generated (randomUUID); it is never a client string.
  if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error("hirecute: malformed run id");
  return path.join(dataDir(), "runs", runId);
}

export function sessionFile(sessionId: string): string {
  if (!/^[0-9a-f]{64}$/.test(sessionId)) throw new Error("hirecute: malformed session id");
  return path.join(dataDir(), "sessions", `${sessionId}.json`);
}

export const paths = {
  snapshot: (runId: string) => path.join(runDir(runId), "run.json"),
  events: (runId: string) => path.join(runDir(runId), "events.ndjson"),
  /** Operator diagnostics. NEVER streamed to a browser. */
  diagnostics: (runId: string) => path.join(runDir(runId), "private", "diagnostics.ndjson"),
  originals: (runId: string) => path.join(runDir(runId), "originals"),
  output: (runId: string) => path.join(runDir(runId), "output"),
  tracker: (runId: string) => path.join(runDir(runId), "data", "applications.md"),
  billingGrants: () => path.join(dataDir(), "billing", "grants.ndjson"),
};

/**
 * Create a run directory with the minimal user-layer files a reused utility
 * needs, and nothing else.
 *
 * The brief: "Bootstrap an empty valid tracker header ... Do not seed the
 * upstream sample candidate, prior reports or personal tracker rows."
 */
export async function bootstrapRunDir(runId: string): Promise<string> {
  const dir = runDir(runId);
  for (const sub of ["originals", "output", "data", "jds", "reports", "config", "modes", "private", "batch/tracker-additions"]) {
    await mkdir(path.join(dir, sub), { recursive: true });
  }
  // An empty but VALID tracker: header row only, no seeded applications.
  await writeFile(
    paths.tracker(runId),
    "# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n",
    "utf8",
  );
  return dir;
}

/**
 * Environment for a spawned child.
 *
 * Built from an ALLOWLIST rather than by deleting known-bad keys, so a new
 * secret in the parent environment cannot leak into a scanner or renderer by
 * default. Stripe and model credentials are deliberately absent: neither a
 * scanner nor a PDF renderer needs them.
 */
/**
 * Credentials a child may be granted. Default: none.
 *
 * The journey worker needs the model key; `build-cv-html.mjs` and
 * `generate-pdf.mjs` do not, and a renderer that never holds a credential
 * cannot leak one. So the grant is per-child and explicit rather than
 * inherited.
 */
export interface EnvGrants {
  model?: boolean;
}

export function childEnv(
  runId: string,
  extra: Record<string, string> = {},
  grants: EnvGrants = {},
): Record<string, string> {
  const dir = runDir(runId);
  const KEEP = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV", "TZ"];
  const base: Record<string, string> = {};
  for (const key of KEEP) {
    const value = process.env[key];
    if (value !== undefined) base[key] = value;
  }

  const credentials: Record<string, string> = {};
  if (grants.model) {
    for (const key of [
      "HIRECUTE_MODEL_API_BASE_URL",
      "HIRECUTE_MODEL_API_KEY",
      "HIRECUTE_MODEL",
    ]) {
      const value = process.env[key];
      if (value !== undefined) credentials[key] = value;
    }
  }
  // Stripe secrets are never granted to any child. Billing runs in the parent.

  return {
    ...base,
    ...credentials,
    // The data root for this ONE run.
    CAREER_OPS_ROOT: dir,
    // Explicit, for the reason in this file's header comment.
    CAREER_OPS_TRACKER: paths.tracker(runId),
    // Replace inherited legacy overrides with run-owned values rather than
    // letting the parent's point at a shared location.
    CAREER_OPS_PORTALS: path.join(dir, "portals.yml"),
    CAREER_OPS_PIPELINE: path.join(dir, "data", "pipeline.md"),
    CAREER_OPS_SCAN_HISTORY: path.join(dir, "data", "scan-history.tsv"),
    CAREER_OPS_DATA_DIR: dir,
    ...extra,
  };
}

/**
 * Env for a deterministic utility child (HTML build, PDF render, fact check).
 *
 * Same run-owned paths, zero credentials — by construction, not by convention.
 */
export function utilityEnv(runId: string): Record<string, string> {
  return childEnv(runId, {}, {});
}

/**
 * Resolve a path that must live inside a run directory.
 *
 * Returns null rather than throwing so a caller can answer 404 without
 * distinguishing "absent" from "not yours" — the difference is exactly what a
 * probe is looking for.
 */
export function containedPath(runId: string, relative: string): string | null {
  const base = runDir(runId);
  const resolved = path.resolve(base, relative);
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  if (resolved !== base && !resolved.startsWith(prefix)) return null;
  return resolved;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function newRunId(): string {
  return randomUUID();
}

/** The raw token goes to the browser; only its hash is stored server-side. */
export function newSessionToken(): { token: string; id: string } {
  const token = randomUUID() + randomUUID();
  return { token, id: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newArtifactId(): string {
  return randomUUID();
}
