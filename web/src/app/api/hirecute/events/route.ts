/**
 * POST /api/hirecute/events — client funnel telemetry.
 *
 * Strictly allowlisted names, and deliberately powerless: a client event can
 * never set card or submission success. `card_setup_succeeded` and
 * `credits_granted` are SERVER names (contracts.ts `ServerFunnelEventName`) and
 * are unreachable from here — the brief calls an automatically opened modal and
 * a client "success" event explicitly not conversions.
 *
 * `eventId` makes the append idempotent, so a retry or double-fire counts once.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { badRequest, json, readJson, requireSameOrigin, str } from "@/lib/hirecute/http";
import { dataDir } from "@/lib/hirecute/paths";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";

const CLIENT_EVENTS = new Set([
  "landing_viewed",
  "bulk_apply_viewed",
  "bulk_job_selected",
  "letter_edited",
  "checkout_auto_opened",
  "checkout_manual_opened",
  "checkout_closed",
]);

const SOURCES = new Set(["fourth_bulk_click", "credits_cta"]);

export async function POST(request: Request) {
  const blocked = requireSameOrigin(request);
  if (blocked) return blocked;

  const body = await readJson<{ eventId?: string; name?: string; jobId?: string; source?: string }>(
    request,
  );
  const eventId = str(body?.eventId, 120);
  const name = str(body?.name, 60);
  if (!eventId || !name || !CLIENT_EVENTS.has(name)) return badRequest("Unknown event.");
  if (body?.source && !SOURCES.has(body.source)) return badRequest("Unknown event source.");

  const session = await currentSession();
  const file = await currentRunFor(session);

  const record = {
    eventId,
    name,
    time: new Date().toISOString(),
    runId: file?.snapshot.id ?? null,
    // `origin` is what lets analytics exclude sample journeys from the live
    // conversion numerator.
    origin: file?.snapshot.origin ?? null,
    jobId: str(body?.jobId, 80),
    source: body?.source ?? null,
  };

  const target = path.join(dataDir(), "analytics", "funnel.ndjson");
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(record)}\n`, "utf8");
  return json({ recorded: true }, 202);
}
