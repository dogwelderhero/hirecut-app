/**
 * GET /api/hirecute/artifacts/:id — download an OWNED artifact.
 *
 * Resolution is by server-generated artifact ID → the run's registry → a
 * containment check. A client-supplied path never reaches the filesystem, and
 * a guessed artifact ID belonging to another session is a 404.
 */

import { readFile } from "node:fs/promises";
import { notFound } from "@/lib/hirecute/http";
import { containedPath } from "@/lib/hirecute/paths";
import { currentSession, ownsRun } from "@/lib/hirecute/session";
import { readRunFile } from "@/lib/hirecute/store";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return notFound();

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return notFound();

  // Search only the runs this session owns. An artifact in someone else's run
  // is indistinguishable from one that does not exist.
  for (const runId of session.ownedRunIds) {
    if (!ownsRun(session, runId)) continue;
    const file = await readRunFile(runId);
    if (!file || file.ownerSessionId !== session.id) continue;
    const entry = file.artifacts[id];
    if (!entry) continue;

    const resolved = containedPath(runId, entry.relativePath);
    // A registry entry that escapes its run directory is refused, not served.
    if (!resolved) return notFound();

    try {
      const bytes = await readFile(resolved);
      const ext = resolved.split(".").pop()?.toLowerCase() ?? "";
      return new Response(new Uint8Array(bytes), {
        headers: {
          "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
          // A server-chosen basename; never the visitor's original file name.
          "content-disposition": `attachment; filename="${entry.kind}.${ext || "bin"}"`,
          "cache-control": "no-store",
        },
      });
    } catch {
      return notFound();
    }
  }
  return notFound();
}
