/**
 * PATCH /api/hirecute/runs/current/decisions — the visitor's choices on this
 * run (applied / skipped resume changes, items left out), kept so a refresh
 * finds them where they were left. Bounded and shape-checked in
 * run-decisions.mjs; they never change what the worker produced.
 */

import { badRequest, json, notFound, readJson, requireSameOrigin } from "@/lib/hirecute/http";
import { mergeDecisions, validateDecisionPatch } from "@/lib/hirecute/run-decisions.mjs";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { updateRun } from "@/lib/hirecute/store";

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const valid = validateDecisionPatch(await readJson<unknown>(request));
  if (!valid.ok) return badRequest(valid.error);

  // Merged inside the run's read-modify-write, so concurrent patches compose.
  const out: { result?: ReturnType<typeof mergeDecisions> } = {};
  await updateRun(file.snapshot.id, (f) => {
    const merged = mergeDecisions(f.snapshot.decisions, valid.patch);
    out.result = merged;
    return merged.ok ? { ...f, snapshot: { ...f.snapshot, decisions: merged.decisions } } : f;
  });
  const result = out.result;
  if (!result) return notFound();
  if (!result.ok) return badRequest(result.error);
  return json({ decisions: result.decisions });
}
