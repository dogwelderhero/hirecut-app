/**
 * GET    /api/hirecute/runs/current — sanitized snapshot for restore/reconnect.
 * DELETE /api/hirecute/runs/current — stop owned work, drop the run.
 *
 * The response carries no owner session ID, no billing record ID and no
 * filesystem path: `sanitizeSnapshot` is the single place that decides.
 */

import { json, notFound, requireSameOrigin } from "@/lib/hirecute/http";
import { currentRunFor, deleteRun, livePosition } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { sanitizeSnapshot } from "@/lib/hirecute/store";

export async function GET() {
  const session = await currentSession();
  const file = await currentRunFor(session);
  // A visitor with no run is a normal state, not an error.
  if (!file) return json({ run: null });
  return json({
    run: sanitizeSnapshot(file),
    queuePosition: livePosition(file.snapshot.id),
  });
}

export async function DELETE(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;
  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!session || !file) return notFound();
  await deleteRun(session, file.snapshot.id);
  return json({ deleted: true });
}
