/**
 * Shared server-boundary helpers for `/api/hirecute/*`.
 *
 * Every route validates here rather than trusting a typed body: TypeScript
 * cannot validate an upload, prove ownership or enforce a numeric range
 * (contracts.ts says so in its own header).
 *
 * Two deliberate choices:
 *  - `notFound()` is returned for both "absent" and "not yours". Distinguishing
 *    them tells a prober that a run ID exists, which is the one bit they want.
 *  - Browser mutations require a same-origin check. The Stripe webhook is the
 *    only exception and gets its own signature verification instead.
 */

import type { ApiErrorResponse, PublicError } from "./contracts";
import { serverConfig } from "@/lib/hirecute/config";
import { publicError } from "@/lib/hirecute/runs";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function apiError(error: PublicError, status: number, currentVersion?: number): Response {
  const body: ApiErrorResponse = currentVersion === undefined ? { error } : { error, currentVersion };
  return json(body, status);
}

/** Absent and unauthorized are the same answer, on purpose. */
export function notFound(): Response {
  return apiError(publicError("not_found", "We could not find that."), 404);
}

export function badRequest(message: string, code: PublicError["code"] = "missing_input"): Response {
  return apiError(publicError(code, message), 400);
}

export function versionConflict(message: string, currentVersion: number): Response {
  return apiError(publicError("version_conflict", message), 409, currentVersion);
}

/**
 * Same-origin guard for mutations.
 *
 * A browser always sends `Origin` on a cross-origin mutation, so a missing
 * Origin is a same-origin or non-browser request; we additionally require that
 * it match the configured base URL when present.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(serverConfig().baseUrl).origin;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: Request): Response | null {
  return sameOrigin(request)
    ? null
    : apiError(publicError("internal_error", "Request blocked."), 403);
}

/** Parse a JSON body defensively; an unparseable body is a 400, not a 500. */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** A non-empty string of bounded length. Anything else is rejected. */
export function str(value: unknown, max = 512): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A bounded array of bounded strings — used for job IDs and preferences. */
export function stringArray(value: unknown, maxItems: number, maxLen = 200): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out: string[] = [];
  for (const item of value) {
    const s = str(item, maxLen);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}
