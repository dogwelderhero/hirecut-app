/**
 * Append-only funnel log, `<dataDir>/analytics/funnel.ndjson`. Server-only.
 *
 * One writer for every source — the client events route and the landing
 * router's `scenario_assigned` — so a record always has the same shape and
 * every record says which scenario it belongs to; that field is what lets the
 * two funnels of an A/B split be compared.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/hirecute/paths";

export interface FunnelRecord {
  eventId: string;
  name: string;
  time: string;
  runId: string | null;
  origin: string | null;
  scenario: string | null;
  [extra: string]: unknown;
}

export async function appendFunnel(record: FunnelRecord): Promise<void> {
  const target = path.join(dataDir(), "analytics", "funnel.ndjson");
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(record)}\n`, "utf8");
}
