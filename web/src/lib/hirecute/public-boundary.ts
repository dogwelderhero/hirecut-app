/**
 * The public API boundary.
 *
 * 01-architecture.md §4: "In the public build, deny legacy `/api/*` except
 * explicit `/api/hirecute/*` routes. Hide/deny its config, memory, updater,
 * general assistant, CLI runner and local apply UI ... Simply setting
 * `CAREER_OPS_WEB_ALLOWED_HOSTS=*` or removing the origin guard is not a
 * migration plan."
 *
 * So this is an ALLOWLIST, not a blocklist of today's legacy routes: a route
 * added upstream tomorrow is denied by default rather than becoming a hole.
 *
 * `HIRECUTE_PUBLIC_BUILD` gates it, defaulting to the value that is safe to get
 * wrong: in production the legacy surface is closed unless an operator opens
 * it, and in development it stays reachable so the inherited screens can be
 * used while milestones 3-8 are built.
 */

/** Path prefixes reachable in a public build. */
const PUBLIC_PREFIXES = ["/api/hirecute/"] as const;

/**
 * The Stripe webhook is the one endpoint with no visitor cookie. It carries its
 * own signature verification instead, so it is listed explicitly rather than
 * inheriting a cookie-based rule.
 */
const PUBLIC_EXACT = ["/api/hirecute/billing/webhook"] as const;

export function isPublicBuild(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.HIRECUTE_PUBLIC_BUILD;
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  // Default by environment: closed in production, open locally.
  return env.NODE_ENV === "production";
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Should this API path be denied?
 *
 * Returns true for every legacy surface in a public build — including the ones
 * that can spawn a CLI, read the operator's files, or reach the local apply
 * browser.
 */
export function deniedInPublicBuild(
  pathname: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isApiPath(pathname)) return false;
  if (!isPublicBuild(env)) return false;
  if (PUBLIC_EXACT.includes(pathname as (typeof PUBLIC_EXACT)[number])) return false;
  return !PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
