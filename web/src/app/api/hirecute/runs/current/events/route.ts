/**
 * GET /api/hirecute/runs/current/events?after=N — typed NDJSON event stream.
 *
 * Three properties the guide is strict about:
 *  - A reconnect replays missing sequence numbers. `after` is a cursor, so the
 *    client can resume exactly where it stopped without duplicating receipts.
 *  - Stream END IS NOT SUCCESS. This route sends keepalives and closes when the
 *    run reaches a terminal status; the client still requires an explicit
 *    `stage.result` / `run.done` before believing anything finished.
 *  - No private diagnostics. This handler has no access to the diagnostics file
 *    at all — it reads only `events.ndjson`.
 *
 * The worker is deliberately NOT tied to this request. If the browser
 * disconnects the child keeps going within its budget (01-architecture.md §6).
 */

import { notFound } from "@/lib/hirecute/http";
import { currentRunFor } from "@/lib/hirecute/runs";
import { currentSession } from "@/lib/hirecute/session";
import { readEventsAfter, readRunFile } from "@/lib/hirecute/store";

const TERMINAL = new Set(["preparation_complete", "failed", "cancelled", "interrupted"]);
const POLL_MS = 400;
const KEEPALIVE_MS = 15_000;

export async function GET(request: Request) {
  const session = await currentSession();
  const file = await currentRunFor(session);
  if (!file) return notFound();

  const runId = file.snapshot.id;
  const url = new URL(request.url);
  const afterRaw = Number(url.searchParams.get("after") ?? "0");
  let cursor = Number.isInteger(afterRaw) && afterRaw >= 0 ? afterRaw : 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSend = Date.now();

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // A client going away must not cancel the worker — only this stream.
      request.signal.addEventListener("abort", close);

      const timer = setInterval(() => {
        void (async () => {
          if (closed) return;
          try {
            const events = await readEventsAfter(runId, cursor);
            for (const event of events) {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
              cursor = event.seq;
              lastSend = Date.now();
            }
            if (Date.now() - lastSend > KEEPALIVE_MS) {
              // Connection health only. Explicitly not task completion.
              controller.enqueue(
                encoder.encode(
                  `${JSON.stringify({
                    version: 1,
                    runId,
                    seq: cursor,
                    time: new Date().toISOString(),
                    input: {
                      journeyVersion: 0,
                      sourceResumeHash: null,
                      preferencesVersion: 0,
                      stageInputVersion: null,
                      stageAttempt: null,
                    },
                    type: "keepalive",
                    payload: {},
                  })}\n`,
                ),
              );
              lastSend = Date.now();
            }

            const latest = await readRunFile(runId);
            // Close only once the run is terminal AND every event has been
            // delivered, so a late stage.result is never stranded.
            if (latest && TERMINAL.has(latest.snapshot.status) && cursor >= latest.snapshot.lastSequence) {
              close();
            }
          } catch {
            close();
          }
        })();
      }, POLL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
    },
  });
}
