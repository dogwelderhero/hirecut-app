/** Types for `run-decisions.mjs`. */
export const DECISION_LIMITS: { maxKeys: number; maxBytes: number };
export function validateDecisionPatch(
  body: unknown,
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };
export function mergeDecisions(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): { ok: true; decisions: Record<string, unknown> } | { ok: false; error: string };
