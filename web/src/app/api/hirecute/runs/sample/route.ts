/**
 * POST /api/hirecute/runs/sample — an explicitly marked demonstration run.
 *
 * `origin: "sample"` travels in the snapshot, so analytics can exclude it from
 * the live-conversion numerator. It takes no private input.
 *
 * It runs the SAME pipeline as an upload, on a fictional resume shipped in
 * `web/fixtures/sample-resume.pdf` — the refine stage reads the visitor's file
 * off disk, so a run created without one fails at its first action with "We
 * could not find your uploaded file." A sample that demonstrates nothing but
 * an error message is worse than no sample, so the fixture is a real PDF and
 * travels through extraction, the model and the career-ops CV chain unchanged.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiError, badRequest, json, readJson, requireSameOrigin, str } from "@/lib/hirecute/http";
import { createRun, publicError } from "@/lib/hirecute/runs";
import { ensureSession } from "@/lib/hirecute/session";

/** The fictional resume every sample run starts from. */
const SAMPLE_RESUME = "sample-resume.pdf";

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const body = await readJson<{ idempotencyNonce?: string }>(request);
  if (!body || !str(body.idempotencyNonce, 200)) return badRequest("Missing idempotency nonce.");

  const session = await ensureSession();

  let original: { fileName: string; bytes: Buffer };
  try {
    const file = path.join(process.cwd(), "fixtures", SAMPLE_RESUME);
    original = { fileName: SAMPLE_RESUME, bytes: await readFile(file) };
  } catch {
    // Say so rather than starting a run that is guaranteed to fail in refine.
    return apiError(
      publicError("capability_disabled", "The sample resume is not available on this deployment.", {
        retryable: false,
      }),
      503,
    );
  }

  const outcome = await createRun({ session, origin: "sample", original });
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
