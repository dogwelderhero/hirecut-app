/**
 * The ownership predicate and session shape, with NO runtime dependency.
 *
 * Split out of `session.ts` because that module imports `next/headers` to read
 * the cookie, which only resolves inside the Next runtime. The *rule* — "a run
 * ID is an identifier, not permission" — is the security-relevant part and
 * must be testable on its own.
 */

export interface SessionRecord {
  id: string;
  createdAt: string;
  /** The single run this browser currently owns, if any. */
  currentRunId: string | null;
  /** Runs this session has owned, so a finished run's artifacts stay reachable. */
  ownedRunIds: string[];
  /** Stripe customer, once billing has created one. Server-side only. */
  stripeCustomerId: string | null;
}

/**
 * Does this session own that run?
 *
 * Checked against `ownedRunIds` rather than only `currentRunId`, so a download
 * from a previous run still works while a guessed ID still fails. A null
 * session owns nothing.
 */
export function ownsRun(session: SessionRecord | null, runId: string): boolean {
  return !!session && session.ownedRunIds.includes(runId);
}
