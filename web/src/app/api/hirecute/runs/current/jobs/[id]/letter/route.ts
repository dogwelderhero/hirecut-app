/**
 * PATCH /api/hirecute/runs/current/jobs/:id/letter — save a candidate edit.
 *
 * Once the visitor edits, an older model generation cannot overwrite their
 * version. The server enforces that with `expectedDraftVersion`: a stale write
 * is a 409 that returns the current revision so the client can reconcile
 * without discarding typed text.
 */

import { badRequest, json, notFound, nonNegativeInt, readJson, requireSameOrigin, str, versionConflict } from "@/lib/hirecute/http";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { appendEvent, updateRun } from "@/lib/hirecute/store";
import { createHash } from "node:crypto";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const { id: jobId } = await ctx.params;
  const pkg = file.snapshot.applications.find((a) => a.jobId === jobId);
  // An unknown or foreign job ID is a 404, same as an absent one.
  if (!pkg) return notFound();

  const body = await readJson<{ text?: string; expectedDraftVersion?: number }>(request);
  const text = str(body?.text, 20_000);
  const expected = nonNegativeInt(body?.expectedDraftVersion);
  if (text === null) return badRequest("A letter cannot be empty.");
  if (expected === null) return badRequest("Missing expected draft version.");

  const currentVersion = pkg.letter.current?.version ?? 0;
  if (currentVersion !== expected) {
    return versionConflict("This draft changed elsewhere.", currentVersion);
  }

  const revision = {
    version: currentVersion + 1,
    author: "candidate" as const,
    text,
    subject: pkg.letter.current?.subject ?? "",
    updatedAt: new Date().toISOString(),
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    sourceFactIds: pkg.letter.current?.sourceFactIds ?? [],
    jobContentHash: pkg.letter.current?.jobContentHash ?? "",
  };

  await updateRun(file.snapshot.id, (f) => ({
    ...f,
    snapshot: {
      ...f.snapshot,
      applications: f.snapshot.applications.map((a) =>
        a.jobId === jobId
          ? { ...a, version: a.version + 1, letter: { status: "ready", current: revision } }
          : a,
      ),
    },
  }));
  await appendEvent(file.snapshot.id, "letter.completed", {
    jobId,
    generationId: `candidate-${revision.version}`,
    revision,
  });
  return json({ jobId, revision });
}
