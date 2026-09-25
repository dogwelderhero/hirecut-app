/**
 * Types for `action-labels.mjs` — the fixed orchestrator vocabulary.
 */

import type { StageId } from "./contracts";

export const ACTION_LABELS: Record<StageId, readonly string[]>;
export function rankingActionLabel(shortlistCount: number | null): string;
export function refineReceipt(changeCount: number): string;
export function exploreReceipt(jobCount: number, sourcesFailed: number): string;
export function matchReceipt(matchCount: number): string;
export function prepareReceipt(prepared: number, blocked: number): string;
