/**
 * Typed view of the orchestrator's fixed action vocabulary.
 *
 * `ActionProgress.label` is documented in contracts.ts as "Fixed orchestrator
 * vocabulary, never raw model reasoning". Centralising the strings is what
 * makes that enforceable: a worker picks an action by key, so it cannot leak
 * model text into the transcript by constructing a label.
 *
 * The values live in `action-labels.mjs` so the worker can import them without
 * type stripping; this module only adds types.
 */

import type { StageId } from "./contracts";
import * as labels from "@/lib/hirecute/action-labels.mjs";

export const ACTION_LABELS: Record<StageId, readonly string[]> = labels.ACTION_LABELS;

export const rankingActionLabel: (shortlistCount: number | null) => string =
  labels.rankingActionLabel;
export const refineReceipt: (changeCount: number) => string = labels.refineReceipt;
export const exploreReceipt: (jobCount: number, sourcesFailed: number) => string =
  labels.exploreReceipt;
export const matchReceipt: (matchCount: number) => string = labels.matchReceipt;
export const prepareReceipt: (prepared: number, blocked: number) => string =
  labels.prepareReceipt;
