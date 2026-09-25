"use client";

/**
 * Browser client for `/api/hirecute/*`.
 *
 * Replaces Milestone 1's in-browser fixture timeline. The envelope is identical,
 * so the run store, presentation machine and screens are unchanged.
 *
 * Two rules from 02-screen-guide.md §2 that live here:
 *  - Restore from the snapshot FIRST, then stream `?after=lastSequence`. A
 *    reconnect must not replay work the visitor already saw.
 *  - Stream EOF is not success. `onEnd` reports that the stream closed; the
 *    caller decides what that means from the last terminal event, not from the
 *    close itself.
 */

import type { PublicRunEvent, RunSnapshot } from "./contracts";

const BASE = "/api/hirecute";

/** Each mutating request carries a nonce so a double click creates one run. */
function nonce(): string {
  return crypto.randomUUID();
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Something went wrong.");
  }
  return (await res.json()) as T;
}

export async function createRunFromFile(file: File): Promise<{ runId: string }> {
  const form = new FormData();
  form.set("file", file);
  form.set("idempotencyNonce", nonce());
  return jsonOrThrow(await fetch(`${BASE}/runs`, { method: "POST", body: form }));
}

export async function createRunFromText(text: string): Promise<{ runId: string }> {
  return jsonOrThrow(
    await fetch(`${BASE}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "pasted_text", text, idempotencyNonce: nonce() }),
    }),
  );
}

export async function createSampleRun(): Promise<{ runId: string }> {
  return jsonOrThrow(
    await fetch(`${BASE}/runs/sample`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyNonce: nonce() }),
    }),
  );
}

export async function fetchCurrentRun(): Promise<{
  run: RunSnapshot | null;
  queuePosition?: number | null;
}> {
  const res = await fetch(`${BASE}/runs/current`, { cache: "no-store" });
  if (!res.ok) return { run: null };
  return (await res.json()) as { run: RunSnapshot | null; queuePosition?: number | null };
}

export async function deleteCurrentRun(): Promise<void> {
  await fetch(`${BASE}/runs/current`, { method: "DELETE" });
}

export async function patchSelection(
  jobIds: string[],
  expectedSelectionVersion: number,
): Promise<{ selection: { jobIds: string[]; version: number } }> {
  return jsonOrThrow(
    await fetch(`${BASE}/runs/current/applications`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobIds, expectedSelectionVersion }),
    }),
  );
}

export async function saveLetter(
  jobId: string,
  text: string,
  expectedDraftVersion: number,
): Promise<{ revision: { version: number; text: string } }> {
  return jsonOrThrow(
    await fetch(`${BASE}/runs/current/jobs/${encodeURIComponent(jobId)}/letter`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, expectedDraftVersion }),
    }),
  );
}

export async function retryStage(stage: string, inputVersion: number): Promise<void> {
  await fetch(`${BASE}/runs/current/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage, inputVersion }),
  });
}

/** Allowlisted funnel event. Powerless by design — it cannot grant anything. */
export async function recordFunnelEvent(
  name: string,
  extra: { jobId?: string; source?: string } = {},
): Promise<void> {
  try {
    await fetch(`${BASE}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: nonce(), name, ...extra }),
    });
  } catch {
    // Telemetry must never break the journey.
  }
}

export interface StreamHandle {
  close: () => void;
}

/**
 * Stream NDJSON events from a cursor.
 *
 * `onEnd` fires when the stream closes for any reason. It deliberately carries
 * no success signal: the caller must look at the events it actually received.
 */
export function streamEvents(
  after: number,
  onEvent: (event: PublicRunEvent) => void,
  onEnd: () => void,
): StreamHandle {
  const controller = new AbortController();

  void (async () => {
    try {
      const res = await fetch(`${BASE}/runs/current/events?after=${after}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) {
        onEnd();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Keep the trailing partial line in the buffer: a chunk boundary can
        // land mid-JSON, and parsing that half would drop a real event.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            onEvent(JSON.parse(line) as PublicRunEvent);
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Abort or network loss. The worker keeps going server-side.
    } finally {
      onEnd();
    }
  })();

  return { close: () => controller.abort() };
}
