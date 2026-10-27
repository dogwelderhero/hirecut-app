import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRequest,
  parseAllowedHosts,
  parseAllowedOrigins,
} from "@/lib/origin-guard.mjs";
import { deniedInPublicBuild } from "@/lib/hirecute/public-boundary";
import { appendFunnel } from "@/lib/hirecute/funnel";
import {
  ATTR_COOKIE,
  SCENARIO_COOKIE,
  SCENARIO_HEADER,
  routeLanding,
} from "@/lib/hirecute/landing-router.mjs";

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
export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname === "/") return routeLandingRequest(req);

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

/**
 * `/`: pick the visitor's scenario (landing-router.mjs), pin it in cookies,
 * hand it to the page as a REQUEST header (never sent to the browser), and log
 * a fresh assignment to the funnel so the two sides of a split can be compared.
 */
async function routeLandingRequest(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const decision = routeLanding(
    {
      query: req.nextUrl.searchParams,
      scenarioCookie: req.cookies.get(SCENARIO_COOKIE)?.value ?? null,
      attrCookie: req.cookies.get(ATTR_COOKIE)?.value ?? null,
      referer: req.headers.get("referer"),
      secure: proto === "https",
    },
    process.env,
  );
  // Broken scenario config: preflight refuses to boot with it, so this is a
  // config changed under a running server. Serve the page; run creation
  // reports the error.
  if (!decision.ok) return NextResponse.next();

  const headers = new Headers(req.headers);
  headers.set(SCENARIO_HEADER, JSON.stringify({ scenario: decision.scenario, reason: decision.reason }));
  const res = NextResponse.next({ request: { headers } });
  for (const { name, value, ...options } of decision.cookies) res.cookies.set(name, value, options);

  if (decision.assigned && decision.attribution) {
    await appendFunnel({
      eventId: crypto.randomUUID(),
      name: "scenario_assigned",
      time: new Date().toISOString(),
      runId: null,
      origin: null,
      ...decision.attribution,
    }).catch(() => {
      // Analytics must never take the landing page down.
    });
  }
  return res;
}

// Constants only: Next analyses the matcher at build time.
export const config = { matcher: ["/api/:path*", "/"] };
