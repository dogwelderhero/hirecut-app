/**
 * POST /api/hirecute/runs/current/retry — retry ONE failed/interrupted stage.
 *
 * Not the whole journey: completed artifacts inside that stage are reused, and
 * a successful stage cannot be retried at all.
 */

import { apiError, badRequest, json, notFound, positiveInt, readJson, requireSameOrigin, versionConflict } from "@/lib/hirecute/http";
import { currentRunFor, retryStage } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { STAGE_ORDER } from "@/lib/hirecute/screens";
import type { StageId } from "@/lib/hirecute/contracts";

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const body = await readJson<{ stage?: string; inputVersion?: number }>(request);
  const stage = body?.stage as StageId | undefined;
  const inputVersion = positiveInt(body?.inputVersion);
  if (!stage || !STAGE_ORDER.includes(stage)) return badRequest("Unknown step.");
  if (inputVersion === null) return badRequest("Missing input version.");

  const result = await retryStage(file.snapshot.id, stage, inputVersion);
  if (!result.ok) {
    if (result.error.code === "version_conflict" && result.currentVersion !== undefined) {
      return versionConflict(result.error.message, result.currentVersion);
    }
    return apiError(result.error, result.error.code === "not_found" ? 404 : 400);
  }
  return json({ stage, status: "queued", inputVersion: inputVersion + 1 }, 202);
}
