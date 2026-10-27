/**
 * Fixed orchestrator vocabulary and receipt copy — plain ESM.
 *
 * `.mjs` rather than `.ts` because the journey WORKER imports it, and a child
 * process should not depend on type stripping to read the label list. The
 * typed surface lives in `actions.ts`, which re-exports this file.
 */


export const ACTION_LABELS = {
  refine: [
    "Opening your file",
    "Reading the text in your resume",
    "Mapping every section and role",
    "Checking every detail against your file",
    "Noting which sections are missing",
    "Checking formatting and readability",
    "Building a clean copy of your resume",
  ],
  explore: [
    "Building a search from your experience",
    "Checking company career pages",
    "Removing duplicates and expired listings",
    "Saving relevant openings",
  ],
  match: [
    "Reading each job description",
    "Checking location and salary fit where evidence exists",
    "Quoting the proof and the gaps for each job",
    // Suffixed with the real shortlist count by rankingActionLabel().
    "Ranking your top roles",
  ],
  improve: [
    "Collecting gaps from your top jobs",
    "Finding proof in your experience",
    "Writing changes for each gap",
    "Checking every change against your resume",
  ],
  prepare: [
    "Matching evidence to roles",
    "Tailoring resumes",
    "Drafting letters",
    "Checking packages",
  ],
};

/**
 * §6: "Ranking your top N roles, with N from the actual shortlist." A count is
 * only rendered when one is genuinely known.
 */
export function rankingActionLabel(shortlistCount) {
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
export function refineReceipt(changeCount) {
  if (changeCount < 1) return "Resume reviewed · Original kept";
  return `Resume refined · ${changeCount} improvement${changeCount === 1 ? "" : "s"} · Original kept`;
}

export function exploreReceipt(jobCount, sourcesFailed) {
  const base = `${jobCount} role${jobCount === 1 ? "" : "s"} saved`;
  // §5: partial coverage is a result, not an error — say so on the receipt.
  return sourcesFailed > 0 ? `${base} · some sources unavailable` : `${base} · duplicates removed`;
}

export function matchReceipt(matchCount) {
  return `${matchCount} top match${matchCount === 1 ? "" : "es"} saved · Ranked by fit · Reasons included`;
}

export function prepareReceipt(prepared, blocked) {
  const base = `${prepared} package${prepared === 1 ? "" : "s"} prepared`;
  return blocked > 0 ? `${base} · ${blocked} need your input` : base;
}
