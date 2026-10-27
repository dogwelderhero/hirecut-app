/**
 * The visitor's decisions on a run (which resume changes they applied or
 * skipped, which items they left out), kept on the server so a page refresh —
 * or another tab — finds them where they were left.
 *
 * Deliberately generic and bounded: screens choose the keys, the server only
 * enforces shape and size. Decisions are the visitor's preferences about
 * presentation, never facts the agent relies on: nothing here changes what the
 * worker produced or what an application contains.
 */

export const DECISION_LIMITS = { maxKeys: 32, maxBytes: 16_384 };

const KEY = /^[a-z][a-z0-9.-]{0,63}$/;

/**
 * Validate a PATCH body: `{ decisions: { key: value | null } }`. A null value
 * deletes the key.
 * @returns {{ok: true, patch: Record<string, unknown>} | {ok: false, error: string}}
 */
export function validateDecisionPatch(body) {
  const patch = body?.decisions;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "Expected decisions." };
  for (const key of Object.keys(patch)) {
    if (!KEY.test(key)) return { ok: false, error: `Unknown decision "${key.slice(0, 64)}".` };
  }
  return { ok: true, patch };
}

/**
 * Merge a validated patch into the stored decisions, enforcing the limits on
 * the RESULT (a patch of small keys must not grow the record without bound).
 * @returns {{ok: true, decisions: Record<string, unknown>} | {ok: false, error: string}}
 */
export function mergeDecisions(current, patch) {
  const next = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (Object.keys(next).length > DECISION_LIMITS.maxKeys) return { ok: false, error: "Too many decisions." };
  if (Buffer.byteLength(JSON.stringify(next), "utf8") > DECISION_LIMITS.maxBytes) {
    return { ok: false, error: "Those decisions are too large." };
  }
  return { ok: true, decisions: next };
}
