/**
 * The orchestrator's fixed action vocabulary.
 *
 * `ActionProgress.label` is documented in contracts.ts as "Fixed orchestrator
 * vocabulary, never raw model reasoning". Centralising the strings here is what
 * makes that enforceable: a worker picks an action by key, so it cannot leak
 * model text into the transcript by constructing a label.
 *
 * Labels come from 02-screen-guide.md §§4–7. Two of them are deliberately
 * hedged versus the prototype's copy:
 *  - explore's "Checking company career pages" — not "Scanning 28,746 boards".
 *  - match's location/salary action says "where evidence exists", because §6
 *    forbids completing "salary matched" when no salary was published.
 */

import type { StageId } from "./contracts";

export const ACTION_LABELS = {
  refine: [
    "Reading your resume",
    "Extracting your experience and skills",
    "Refining your summary and bullet points",
    "Checking formatting and readability",
  ],
  explore: [
    "Building a search from your experience",
    "Checking company career pages",
    "Removing duplicates and expired listings",
    "Saving relevant openings",
  ],
  match: [
    "Comparing skills and seniority",
    "Checking location and salary fit where evidence exists",
    "Finding evidence for each match",
    // Suffixed with the real shortlist count by rankingActionLabel().
    "Ranking your top roles",
  ],
  prepare: [
    "Matching evidence to roles",
    "Tailoring resumes",
    "Drafting letters",
    "Checking packages",
  ],
} as const satisfies Record<StageId, readonly string[]>;

/**
 * §6: "Ranking your top N roles, with N from the actual shortlist." A count is
 * only rendered when one is genuinely known.
 */
export function rankingActionLabel(shortlistCount: number | null): string {
  if (shortlistCount === null || shortlistCount < 1) return "Ranking your top roles";
  return `Ranking your top ${shortlistCount} role${shortlistCount === 1 ? "" : "s"}`;
}

/**
 * Stage receipt copy for the conversation transcript.
 *
 * Counts are always passed in from real results — §4 is explicit that "8
 * improvements" must not be hardcoded, and that a valid no-change result reads
 * "Resume reviewed · Original kept" rather than inventing changes to make the
 * counter interesting.
 */
export function refineReceipt(changeCount: number): string {
  if (changeCount < 1) return "Resume reviewed · Original kept";
  return `Resume refined · ${changeCount} improvement${changeCount === 1 ? "" : "s"} · Original kept`;
}

export function exploreReceipt(jobCount: number, sourcesFailed: number): string {
  const base = `${jobCount} role${jobCount === 1 ? "" : "s"} saved`;
  // §5: partial coverage is a result, not an error — say so on the receipt.
  return sourcesFailed > 0 ? `${base} · some sources unavailable` : `${base} · duplicates removed`;
}

export function matchReceipt(matchCount: number): string {
  return `${matchCount} top match${matchCount === 1 ? "" : "es"} saved · Ranked by fit · Reasons included`;
}

export function prepareReceipt(prepared: number, blocked: number): string {
  const base = `${prepared} package${prepared === 1 ? "" : "s"} prepared`;
  return blocked > 0 ? `${base} · ${blocked} need your input` : base;
}
