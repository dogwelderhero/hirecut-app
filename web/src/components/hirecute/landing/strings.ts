import type { LandingStrings } from "@/lib/hirecute/landing-content.mjs";
import { format } from "@/lib/hirecute/landing-strings.mjs";

/**
 * Read a landing string. Validation (preflight, tests) guarantees every key a
 * block uses exists for every enabled scenario, so a miss here means the build
 * and the content drifted: show the key rather than an empty element, so it is
 * visible on the page instead of silently blank.
 */
export function t(s: LandingStrings, key: string, params?: Record<string, string | number>): string {
  const v = s[key];
  return typeof v === "string" ? format(v, params) : key;
}

/** A list value (strings or objects). A missing key is an empty list. */
export function list<T>(s: LandingStrings, key: string): T[] {
  const v = s[key];
  return Array.isArray(v) ? (v as T[]) : [];
}
