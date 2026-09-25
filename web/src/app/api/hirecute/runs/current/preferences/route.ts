/**
 * PATCH /api/hirecute/runs/current/preferences — explicit preference edits.
 *
 * Saving a preference invalidates the downstream search/rank/preparation for
 * the changed input version and restarts discovery IN PLACE. It does not create
 * a new screen, and it keeps the refined resume (02-screen-guide.md §5).
 *
 * Preferences are only ever what the visitor confirmed. An unset location does
 * not become the CV's city, and it never implies work authorization.
 */

import { badRequest, json, notFound, positiveInt, readJson, requireSameOrigin, stringArray, versionConflict } from "@/lib/hirecute/http";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { appendEvent, updateRun } from "@/lib/hirecute/store";

const WORK_STYLES = new Set(["remote", "hybrid", "onsite"]);

export async function PATCH(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const body = await readJson<{
    expectedVersion?: number;
    targetRoles?: unknown;
    locations?: unknown;
    workStyles?: unknown;
  }>(request);

  const expected = positiveInt(body?.expectedVersion);
  const targetRoles = stringArray(body?.targetRoles ?? [], 30);
  const locations = stringArray(body?.locations ?? [], 30);
  const workStyles = stringArray(body?.workStyles ?? [], 3, 12);
  if (expected === null) return badRequest("Missing expected version.");
  if (targetRoles === null || locations === null || workStyles === null) {
    return badRequest("Those preferences are too long.");
  }
  if (workStyles.some((w) => !WORK_STYLES.has(w))) return badRequest("Unknown work style.");

  const current = file.snapshot.preferences;
  if (current.version !== expected) {
    return versionConflict("Your preferences changed elsewhere.", current.version);
  }

  const preferences = {
    ...current,
    version: current.version + 1,
    targetRoles,
    locations,
    // Validated against WORK_STYLES above, so the narrowing is sound.
    workStyles: workStyles as Array<"remote" | "hybrid" | "onsite">,
    origin: "confirmed_by_candidate" as const,
  };

  const updated = await updateRun(file.snapshot.id, (f) => ({
    ...f,
    snapshot: {
      ...f.snapshot,
      preferences,
      // Bumping journeyVersion makes the previous attempt's in-flight worker
      // events stale, so a running child cannot commit results for the old
      // preferences after they changed.
      journeyVersion: f.snapshot.journeyVersion + 1,
      // The refined resume is explicitly retained; only the downstream stages
      // are invalidated.
      stages: {
        ...f.snapshot.stages,
        explore: { ...f.snapshot.stages.explore, status: "queued", inputVersion: f.snapshot.stages.explore.inputVersion + 1, result: null, error: null },
        match: { ...f.snapshot.stages.match, status: "pending", inputVersion: f.snapshot.stages.match.inputVersion + 1, result: null, error: null },
        prepare: { ...f.snapshot.stages.prepare, status: "pending", inputVersion: f.snapshot.stages.prepare.inputVersion + 1, result: null, error: null },
      },
    },
  }));

  await appendEvent(file.snapshot.id, "stage.started", {
    stage: "explore",
    inputVersion: updated.snapshot.stages.explore.inputVersion,
    attempt: updated.snapshot.stages.explore.attempt,
  });
  return json({ preferences, invalidated: ["explore", "match", "prepare"] });
}
