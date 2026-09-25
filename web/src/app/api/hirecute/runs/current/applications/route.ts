/**
 * PATCH /api/hirecute/runs/current/applications — the inclusion set.
 *
 * Rejects unknown job IDs and handles version conflicts without losing the
 * visitor's last change. Unselecting a job does NOT delete its prepared draft.
 */

import { badRequest, json, notFound, positiveInt, readJson, requireSameOrigin, stringArray, versionConflict } from "@/lib/hirecute/http";
import { LIMITS } from "@/lib/hirecute/config";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { appendEvent, updateRun } from "@/lib/hirecute/store";

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const body = await readJson<{ jobIds?: unknown; expectedSelectionVersion?: number }>(request);
  const jobIds = stringArray(body?.jobIds, LIMITS.maxSelectedPackages);
  const expected = positiveInt(body?.expectedSelectionVersion);
  if (jobIds === null) {
    return badRequest(`Select at most ${LIMITS.maxSelectedPackages} roles.`);
  }
  if (expected === null) return badRequest("Missing expected selection version.");

  const current = file.snapshot.selection;
  if (current.version !== expected) {
    return versionConflict("Your selection changed elsewhere.", current.version);
  }

  // A foreign or unknown ID is refused rather than silently dropped: the
  // visitor's count must match what the server stored.
  const known = new Set(file.snapshot.jobs.map((j) => j.id));
  const unknown = jobIds.filter((id) => !known.has(id));
  if (unknown.length > 0) return badRequest("One of those roles is no longer available.");
  if (new Set(jobIds).size !== jobIds.length) return badRequest("Duplicate roles in selection.");

  const selection = {
    jobIds,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  };
  await updateRun(file.snapshot.id, (f) => ({
    ...f,
    snapshot: { ...f.snapshot, selection },
  }));
  await appendEvent(file.snapshot.id, "selection.updated", { selection });
  return json({ selection });
}
