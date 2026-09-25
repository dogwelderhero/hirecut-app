"use client";

/**
 * Journey container: owns the run store and the event source.
 *
 * Milestone 2 replaced the in-browser fixture timeline with the real API:
 * restore from `GET /runs/current`, then stream `?after=lastSequence`. Because
 * both spoke the same envelope, nothing downstream changed.
 *
 * Screen selection is the server snapshot's business, not a hash's: the hash
 * chooses a view, `hasRun` decides whether that view is allowed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobId, PublicRunEvent } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import {
  applyEvent,
  initialRunState,
  lifecycleOnStreamEnd,
  restoreSnapshot,
  type RunState,
} from "@/lib/hirecute/run-store";
import {
  createRunFromFile,
  createSampleRun,
  deleteCurrentRun,
  fetchCurrentRun,
  patchSelection,
  recordFunnelEvent,
  saveLetter,
  streamEvents,
  type StreamHandle,
} from "@/lib/hirecute/client";
import { displayText, emptyLetter, type LetterMap } from "@/lib/hirecute/letters";
import { resolveHash, SCREEN_HASH } from "@/lib/hirecute/screens";
import { Landing } from "./landing";
import { Workspace } from "./workspace";

export function HirecuteJourney({ publicConfig }: { publicConfig: PublicConfig }) {
  const [runState, setRunState] = useState<RunState>(initialRunState);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  /**
   * LOCAL letter edits only. Streamed/committed text is a projection of server
   * events; a visitor's edit must survive the next event touching that job, so
   * it is held separately and overlaid (see `letters`).
   */
  const [edits, setEdits] = useState<LetterMap>({});
  const stream = useRef<StreamHandle | null>(null);

  const hasRun = runState.lifecycle !== "absent";
  const isSample = runState.snapshot?.origin === "sample";

  const letters: LetterMap = useMemo(() => {
    const merged: LetterMap = {};
    const ids = new Set([...Object.keys(runState.letters), ...Object.keys(edits)]);
    for (const id of ids) {
      const server = runState.letters[id] ?? emptyLetter(id);
      const edit = edits[id];
      merged[id] = edit?.dirty
        ? { ...server, editingText: edit.editingText, dirty: true }
        : server;
    }
    return merged;
  }, [runState.letters, edits]);

  const onEvent = useCallback((event: PublicRunEvent) => {
    // The store's `seq` guard makes a duplicated delivery inert, so a reconnect
    // that overlaps by a few events cannot duplicate a transcript row.
    setRunState((prev) => applyEvent(prev, event));
  }, []);

  /** Attach the stream from a cursor. Idempotent: closes any previous one. */
  const attachStream = useCallback(
    (after: number) => {
      stream.current?.close();
      stream.current = streamEvents(after, onEvent, () => {
        // Stream EOF is NOT success. The store decides from what it received.
        setRunState((prev) => ({ ...prev, lifecycle: lifecycleOnStreamEnd(prev) }));
      });
    },
    [onEvent],
  );

  // Restore on mount: snapshot first, then replay only what is missing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { run } = await fetchCurrentRun();
      if (cancelled) return;
      if (run) {
        setRunState(restoreSnapshot(run));
        attachStream(run.lastSequence);
      }
      setRestored(true);
    })();
    return () => {
      cancelled = true;
      stream.current?.close();
    };
  }, [attachStream]);

  const start = useCallback(
    async (kind: { sample: true } | { sample: false; file: File }) => {
      setError(null);
      setEdits({});
      try {
        if (kind.sample) {
          setFileName("sample-resume.pdf");
          await createSampleRun();
        } else {
          setFileName(kind.file.name);
          await createRunFromFile(kind.file);
        }
      } catch (err) {
        // A failure before the run is accepted stays beside the drop zone.
        setFileName(null);
        setError(err instanceof Error ? err.message : "That upload could not be accepted.");
        return;
      }
      const { run } = await fetchCurrentRun();
      if (run) {
        setRunState(restoreSnapshot(run));
        attachStream(run.lastSequence);
        if (typeof window !== "undefined") window.location.hash = SCREEN_HASH.refine;
      }
    },
    [attachStream],
  );

  const onSelectionChange = useCallback(
    async (ids: JobId[]) => {
      const expected = runState.selection?.version ?? 1;
      try {
        const { selection } = await patchSelection(ids, expected);
        setRunState((prev) => ({
          ...prev,
          selection: { ...selection, updatedAt: new Date().toISOString() },
        }));
      } catch {
        // A version conflict must not lose the visitor's last change: re-read
        // the authoritative selection rather than guessing.
        const { run } = await fetchCurrentRun();
        if (run) setRunState((prev) => ({ ...prev, selection: run.selection }));
      }
    },
    [runState.selection?.version],
  );

  const onSaveLetter = useCallback(
    async (jobId: JobId) => {
      const view = letters[jobId];
      if (!view) return;
      try {
        await saveLetter(jobId, displayText(view), view.serverVersion);
        setEdits((prev) => {
          const next = { ...prev };
          delete next[jobId];
          return next;
        });
        void recordFunnelEvent("letter_edited", { jobId });
      } catch {
        // Keep the local text; the inline status shows unsaved changes.
      }
    },
    [letters],
  );

  const screen = useMemo(() => {
    const hash = typeof window === "undefined" ? null : window.location.hash;
    return resolveHash(hash, hasRun);
  }, [hasRun]);

  // Avoid flashing the landing page before the snapshot answers.
  if (!restored) return <div className="min-h-dvh" aria-busy="true" />;

  if (!hasRun || screen === "upload") {
    return (
      <Landing
        launchProfile={publicConfig.launchProfile}
        maxUploadBytes={publicConfig.maxUploadBytes}
        error={error}
        onUpload={(file) => void start({ sample: false, file })}
        onSample={() => void start({ sample: true })}
      />
    );
  }

  return (
    <>
      {isSample && (
        <div className="border-b border-border bg-secondary px-5 py-2 text-center text-[12px] text-muted-foreground">
          Sample journey — illustrative data, excluded from our conversion metrics.
        </div>
      )}
      <Workspace
        runState={runState}
        publicConfig={publicConfig}
        fileName={fileName}
        letters={letters}
        onLettersChange={setEdits}
        onSelectionChange={(ids) => void onSelectionChange(ids)}
        onSaveLetter={(id) => void onSaveLetter(id)}
        onRestart={() => {
          stream.current?.close();
          void deleteCurrentRun();
          setRunState(initialRunState());
          setEdits({});
          setFileName(null);
          if (typeof window !== "undefined") window.location.hash = SCREEN_HASH.upload;
        }}
      />
    </>
  );
}
