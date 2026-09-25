import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRequest,
  parseAllowedHosts,
  parseAllowedOrigins,
} from "@/lib/origin-guard.mjs";
import { deniedInPublicBuild } from "@/lib/hirecute/public-boundary";

// Single choke point over the API surface. Every /api request is gated on the
// same-origin + loopback guard before it can reach a route handler (which may
// spawn a child process or write the user's files). See origin-guard.mjs for
// the two-layer rationale (F1 drive-by CSRF, F2 LAN reachability).
//
// Opt in to extra hosts (e.g. a trusted LAN box) with a comma/space separated
// CAREER_OPS_WEB_ALLOWED_HOSTS; unset means loopback only.
//
// Opt in to extra *origins* the same way with CAREER_OPS_ALLOWED_ORIGINS;
// unset means none, which is the default and leaves the guard as strict as it
// was. It is what a local companion client needs: a browser extension calls
// from a chrome-extension:// origin, which Fetch Metadata always reports as
// "cross-site", so every one of its requests is refused otherwise.
export function proxy(req: NextRequest) {
  // hirecute: in a public build only /api/hirecute/* is reachable. The legacy
  // alpha API can spawn CLIs, read operator files and drive a local browser, so
  // it is denied by ALLOWLIST here rather than by enumerating today's routes —
  // a route added upstream tomorrow is closed by default. This runs before the
  // origin guard because "not part of the product" outranks "wrong origin".
  if (deniedInPublicBuild(req.nextUrl.pathname)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const decision = checkRequest({
    secFetchSite: req.headers.get("sec-fetch-site"),
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    allowedHosts: parseAllowedHosts(process.env.CAREER_OPS_WEB_ALLOWED_HOSTS),
    allowedOrigins: parseAllowedOrigins(process.env.CAREER_OPS_ALLOWED_ORIGINS),
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.reason }, { status: decision.status });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
