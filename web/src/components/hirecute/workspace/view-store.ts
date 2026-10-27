"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { saveDecisions } from "@/lib/hirecute/client";
import type { ViewStore } from "./types";

/**
 * The shell's per-run state store, so a refresh finds the visitor where they
 * left off. Two tiers, chosen by key:
 *
 *   "decision:<key>"  the visitor's choices (applied / skipped changes…): kept
 *                     on the server with the run (PATCH /runs/current/decisions),
 *                     batched, the last write sent with `keepalive`.
 *   anything else     view state (which panel is open, saved/expanded jobs…):
 *                     sessionStorage, per run, this tab only.
 *
 * Loaded synchronously on the first render for a run, so a restored screen
 * never paints its empty state first and then jumps.
 */

const DECISION = "decision:";
const DEBOUNCE_MS = 250;

const sessionKey = (runId: string) => `hc:${runId}:view`;

function readSession(runId: string): Record<string, unknown> {
  try {
    const raw = window.sessionStorage.getItem(sessionKey(runId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {}; // storage blocked or corrupt: start clean rather than fail
  }
}

function writeSession(runId: string, data: Record<string, unknown>) {
  try {
    const view = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith(DECISION)));
    window.sessionStorage.setItem(sessionKey(runId), JSON.stringify(view));
  } catch {
    /* quota or privacy mode: the view simply does not survive a refresh */
  }
}

function load(runId: string | null, decisions: Record<string, unknown> | undefined) {
  if (!runId || typeof window === "undefined") return {};
  const fromServer = Object.fromEntries(Object.entries(decisions ?? {}).map(([k, v]) => [DECISION + k, v]));
  return { ...fromServer, ...readSession(runId) };
}

export function useViewStore(runId: string | null, decisions: Record<string, unknown> | undefined): ViewStore {
  const data = useRef<{ runId: string | null; values: Record<string, unknown> }>({ runId: null, values: {} });
  if (data.current.runId !== runId) data.current = { runId, values: load(runId, decisions) };
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) void saveDecisions(patch).catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const set = useCallback(<T,>(key: string, next: T | ((prev: T | undefined) => T)) => {
    const { runId: id, values } = data.current;
    const value = typeof next === "function" ? (next as (p: T | undefined) => T)(values[key] as T | undefined) : next;
    data.current = { runId: id, values: { ...values, [key]: value } };
    bump();
    if (!id) return;
    if (key.startsWith(DECISION)) {
      pending.current[key.slice(DECISION.length)] = value ?? null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    } else {
      writeSession(id, data.current.values);
    }
  }, [flush]);

  return useMemo<ViewStore>(
    () => ({
      get: <T,>(key: string, fallback: T) => (key in data.current.values ? (data.current.values[key] as T) : fallback),
      set,
    }),
    // `version` re-creates the store after each write so consumers re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set, version, runId],
  );
}
