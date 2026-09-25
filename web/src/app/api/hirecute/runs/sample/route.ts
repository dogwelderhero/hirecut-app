/**
 * POST /api/hirecute/runs/sample — an explicitly marked demonstration run.
 *
 * `origin: "sample"` travels in the snapshot, so analytics can exclude it from
 * the live-conversion numerator. It takes no private input.
 */

import { apiError, badRequest, json, readJson, requireSameOrigin, str } from "@/lib/hirecute/http";
import { createRun, publicError } from "@/lib/hirecute/runs";
import { ensureSession } from "@/lib/hirecute/session";

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const body = await readJson<{ idempotencyNonce?: string }>(request);
  if (!body || !str(body.idempotencyNonce, 200)) return badRequest("Missing idempotency nonce.");

  const session = await ensureSession();
  const outcome = await createRun({ session, origin: "sample" });
  if (outcome.rejected) {
    return apiError(
      publicError("queue_full", "Your agent is busy right now. Try again in a moment.", {
        retryable: true,
      }),
      503,
    );
  }
  return json({ runId: outcome.runId, status: "queued", origin: "sample" }, 202);
}
