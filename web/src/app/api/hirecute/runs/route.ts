/**
 * POST /api/hirecute/runs — create a run from an upload, or from pasted text.
 *
 * Establishes the anonymous cookie, stores the original under a server-chosen
 * basename, queues the work and returns 202. The visitor moves straight into
 * Finetune; there is no separate "uploaded" screen.
 */

import { LIMITS } from "@/lib/hirecute/config";
import { apiError, badRequest, json, readJson, requireSameOrigin, str, stringArray } from "@/lib/hirecute/http";
import { createRun, publicError } from "@/lib/hirecute/runs";
import { ensureSession } from "@/lib/hirecute/session";

/** Magic bytes, because a file name is not a file type. */
function sniff(bytes: Buffer): "pdf" | "docx" | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // DOCX is a ZIP container.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "docx";
  return null;
}

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const contentType = request.headers.get("content-type") ?? "";
  const session = await ensureSession();

  // ── Pasted-text recovery path (unreadable/scanned document) ──────────
  if (contentType.includes("application/json")) {
    const body = await readJson<{ kind?: string; text?: string; idempotencyNonce?: string }>(request);
    if (!body || body.kind !== "pasted_text") return badRequest("Unsupported request body.");
    const text = str(body.text, 200_000);
    if (!text) return badRequest("Paste the text of your resume to continue.", "unreadable_resume");
    if (!str(body.idempotencyNonce, 200)) return badRequest("Missing idempotency nonce.");

    const outcome = await createRun({
      session,
      origin: "pasted_resume",
      original: { fileName: "resume.txt", bytes: Buffer.from(text, "utf8") },
    });
    if (outcome.rejected) {
      return apiError(
        publicError("queue_full", "Your agent is busy right now. Try again in a moment.", {
          retryable: true,
        }),
        503,
      );
    }
    return json({ runId: outcome.runId, status: "queued", origin: "pasted_resume" }, 202);
  }

  // ── Multipart upload ─────────────────────────────────────────────────
  if (!contentType.includes("multipart/form-data")) return badRequest("Expected a file upload.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("That upload could not be read.", "invalid_upload");
  }

  if (!str(form.get("idempotencyNonce"), 200)) return badRequest("Missing idempotency nonce.");

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("Choose a PDF or DOCX file.", "invalid_upload");
  if (file.size === 0) return badRequest("That file is empty.", "invalid_upload");
  if (file.size > LIMITS.maxUploadBytes) {
    return badRequest(
      `That file is larger than ${Math.floor(LIMITS.maxUploadBytes / 1024 / 1024)} MB.`,
      "invalid_upload",
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // A misleading extension or content-type is rejected on the real bytes.
  const kind = sniff(bytes);
  if (!kind) return badRequest("That file is not a PDF or DOCX.", "invalid_upload");

  const roles = stringArray(
    form.getAll("confirmedTargetRoles").filter((v) => typeof v === "string"),
    20,
  );
  const locations = stringArray(
    form.getAll("confirmedLocations").filter((v) => typeof v === "string"),
    20,
  );

  const outcome = await createRun({
    session,
    origin: "uploaded_resume",
    original: { fileName: `resume.${kind}`, bytes },
    confirmedTargetRoles: roles ?? undefined,
    confirmedLocations: locations ?? undefined,
  });
  if (outcome.rejected) {
    return apiError(
      publicError("queue_full", "Your agent is busy right now. Try again in a moment.", {
        retryable: true,
      }),
      503,
    );
  }
  return json({ runId: outcome.runId, status: "queued", origin: "uploaded_resume" }, 202);
}
