/**
 * Screen identity and historical hash canonicalization.
 *
 * The prototype shipped eleven `#state-N` hashes; the accepted product has six
 * visible screens. 02-screen-guide.md §1 specifies exactly how the old hashes
 * fall back, and the rule that matters is the last one: "The server snapshot,
 * not a hash, determines what real artifacts are available." A hash chooses a
 * view; it never asserts that work exists.
 */

import type { ScreenId, StageId } from "./contracts";

/**
 * Explore Jobs no longer has a screen of its own: it runs in parallel with
 * the resume review and its roles fill the right half of that screen. The
 * `explore` ScreenId stays in the contract so old links still resolve.
 */
export const SCREEN_ORDER: readonly ScreenId[] = [
  "upload",
  "refine",
  "matches",
  "improve",
  "checkout",
] as const;

/** The four agent stages, in order. `checkout` and `upload` are not stages. */
/**
 * The journey's stages, in order: read the resume (1), find jobs and score
 * them with gaps (2), improve the resume from those gaps (3). Step 4, the
 * recruiters, is not backend work and shares the improve screen. `prepare`
 * (bulk apply) is no longer run but stays so stored runs still render.
 */
export const STAGE_ORDER: readonly StageId[] = ["refine", "explore", "match", "improve", "prepare"] as const;

const STAGE_TO_SCREEN: Record<StageId, ScreenId> = {
  refine: "refine",
  explore: "matches",
  match: "matches",
  improve: "improve",
  prepare: "bulk_apply",
};

export function screenForStage(stage: StageId): ScreenId {
  return STAGE_TO_SCREEN[stage];
}

/** Canonical hash per visible screen, preserving the historical numbering. */
export const SCREEN_HASH: Record<ScreenId, string> = {
  upload: "state-1",
  refine: "state-3",
  explore: "state-5",
  matches: "state-7",
  improve: "state-18",
  bulk_apply: "state-9",
  checkout: "state-11",
};

/**
 * Every historical hash → the screen it resolves to.
 *
 * - 4/6/8/10 were *result phases* of 3/5/7/9, not separate screens.
 * - 2 was the removed "resume uploaded" page: it enters Finetune only when a
 *   run exists, otherwise upload.
 * - 12/17 were the removed activation/outcome screens: they may resolve to the
 *   checkout overlay, but only with owned run context.
 * - 13/14 were application-progress screens → Bulk Apply. 15 → upload. 16 →
 *   Explore.
 *
 * `requiresRun` marks the hashes that must not be honoured without a run, so a
 * copied link cannot present a workspace that has no artifacts behind it.
 */
interface HashResolution {
  screen: ScreenId;
  requiresRun: boolean;
}

const HASH_TABLE: Record<string, HashResolution> = {
  "state-1": { screen: "upload", requiresRun: false },
  "state-2": { screen: "refine", requiresRun: true },
  "state-3": { screen: "refine", requiresRun: true },
  "state-4": { screen: "refine", requiresRun: true },
  "state-5": { screen: "refine", requiresRun: true },
  "state-6": { screen: "refine", requiresRun: true },
  "state-7": { screen: "matches", requiresRun: true },
  "state-8": { screen: "matches", requiresRun: true },
  "state-9": { screen: "bulk_apply", requiresRun: true },
  "state-10": { screen: "bulk_apply", requiresRun: true },
  "state-11": { screen: "checkout", requiresRun: true },
  "state-12": { screen: "checkout", requiresRun: true },
  "state-13": { screen: "bulk_apply", requiresRun: true },
  "state-14": { screen: "bulk_apply", requiresRun: true },
  "state-15": { screen: "upload", requiresRun: false },
  "state-16": { screen: "refine", requiresRun: true },
  "state-17": { screen: "checkout", requiresRun: true },
  "state-18": { screen: "improve", requiresRun: true },
};

/**
 * Resolve a location hash to a screen.
 *
 * `hasRun` is the server snapshot's answer, not a client guess. Anything
 * unknown, or requiring a run the visitor does not own, falls back to upload —
 * never to a resurrected removed screen.
 */
export function resolveHash(hash: string | null | undefined, hasRun: boolean): ScreenId {
  if (!hash) return hasRun ? "refine" : "upload";
  const key = hash.replace(/^#/, "").trim();
  const hit = HASH_TABLE[key];
  if (!hit) return hasRun ? "refine" : "upload";
  if (hit.requiresRun && !hasRun) return "upload";
  return hit.screen;
}

/** The credits banner starts at Top Matches and persists into Bulk Apply. */
export function showsCreditsBanner(screen: ScreenId): boolean {
  return screen === "matches" || screen === "bulk_apply" || screen === "checkout";
}
