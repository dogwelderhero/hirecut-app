/**
 * Score presentation.
 *
 * 02-screen-guide.md §6: `score5` is the model's validated 1–5 assessment and
 * the only persisted number. The display value is derived exactly, every time:
 *
 *     Math.round(score5 / 5 * 100)
 *
 * Two rules this module exists to enforce:
 *  - There is no independently editable percentage. Deriving it here means a
 *    card can never drift from the stored assessment.
 *  - An absent, invalid or interrupted evaluation is "Not scored". Never a
 *    default, never the prototype's 98%.
 *
 * The label is "profile match", never a likelihood of an interview.
 */

import type { MatchAssessment, MatchPresentation } from "./contracts";

export const MATCH_LABEL = "profile match";
export const MATCH_EXPLANATION = "AI profile match, not an interview probability";
export const NOT_SCORED_LABEL = "Not scored";

function band(score5: number): MatchPresentation["band"] {
  if (score5 >= 4.5) return "strong";
  if (score5 >= 3.5) return "good";
  if (score5 >= 2.5) return "moderate";
  return "low";
}

/** A score5 that runtime validation should have rejected. */
function isValidScore5(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
}

/**
 * Derive the presentation for an assessment, or `null` when there is nothing
 * legitimate to show. `null` renders as "Not scored" with no ring — callers
 * must not substitute a placeholder number.
 */
export function matchPresentation(
  assessment: Pick<MatchAssessment, "score5"> | null | undefined,
): MatchPresentation | null {
  if (!assessment || !isValidScore5(assessment.score5)) return null;
  return {
    matchPercent: Math.round((assessment.score5 / 5) * 100),
    band: band(assessment.score5),
    explanation: MATCH_EXPLANATION,
  };
}

/**
 * Ranking order for the shortlist: validated score descending.
 *
 * Unscored jobs sort last rather than being dropped — they are real openings
 * whose evaluation failed, and §6 requires them to stay visible without a ring.
 * Ties break on jobId so the order is stable across renders; §6 also forbids
 * reordering a focused card unexpectedly, which stability is a precondition for.
 */
export function rankByScore<T extends { jobId: string; score5?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const av = isValidScore5(a.score5) ? a.score5 : null;
    const bv = isValidScore5(b.score5) ? b.score5 : null;
    if (av === null && bv === null) return a.jobId.localeCompare(b.jobId);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return bv - av;
    return a.jobId.localeCompare(b.jobId);
  });
}

/**
 * Posting age. §5: a missing `postedAt` is "Date not listed" — never "Just
 * posted", and never derived from fetch time.
 */
export function postingAgeLabel(
  postedAt: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!postedAt) return "Date not listed";
  const ts = Date.parse(postedAt);
  if (!Number.isFinite(ts)) return "Date not listed";
  const days = Math.floor((now - ts) / 86_400_000);
  if (days < 0) return "Date not listed";
  if (days === 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  if (days < 30) return `Posted ${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "Posted 1 month ago" : `Posted ${months} months ago`;
}
