"use client";

/**
 * Journey container: owns the run store and the event source.
 *
 * In Milestone 1 the event source is the fixture timeline. Milestone 2 swaps it
 * for `GET /api/hirecute/runs/current/events?after=N` plus a snapshot restore —
 * and because both speak the same envelope, only this file changes.
 *
 * Screen selection is the server snapshot's business, not a hash's: the hash
 * chooses a view, `hasRun` decides whether that view is allowed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JobId } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import { applyEvent, initialRunState, type RunState } from "@/lib/hirecute/run-store";
import { fixtureTimeline } from "@/lib/hirecute/fixture-journey";
import { emptyLetter, type LetterMap } from "@/lib/hirecute/letters";
import { resolveHash, SCREEN_HASH } from "@/lib/hirecute/screens";
import { Landing } from "./landing";
import { Workspace } from "./workspace";

export function HirecuteJourney({ publicConfig }: { publicConfig: PublicConfig }) {
  const [runState, setRunState] = useState<RunState>(initialRunState);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * LOCAL letter edits only. The received/streamed text is a projection of
   * server events and lives in the run store; a visitor's edit has to survive
   * the next event that touches that job, so it is held separately and
   * overlaid on top (see `letters` below).
   */
  const [edits, setEdits] = useState<LetterMap>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const hasRun = runState.lifecycle !== "absent";
  /**
   * What the letter panel renders: the run store's streamed/committed text,
   * with any dirty local edit layered over it. This is the "candidate version
   * wins over a stale generation" rule from §7, expressed as a projection so a
   * late `letter.delta` cannot silently replace typed text.
   */
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


  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  /** Schedule the fixture timeline. Replaced by the real stream in M2. */
  const startJourney = useCallback(
    (opts: { fileName: string | null; sample: boolean }) => {
      clearTimers();
      setRunState(initialRunState());
      setEdits({});
      setError(null);
      setFileName(opts.fileName);
      setIsSample(opts.sample);
      if (typeof window !== "undefined") {
        window.location.hash = SCREEN_HASH.refine;
      }
      for (const { at, event } of fixtureTimeline()) {
        timers.current.push(
          setTimeout(() => {
            setRunState((prev) => applyEvent(prev, event));
          }, at),
        );
      }
    },
    [clearTimers],
  );

  // Cancel pending reveals/timers on unmount (counter sub-rule 9).
  useEffect(() => clearTimers, [clearTimers]);

  const onSelectionChange = useCallback(
    (ids: JobId[]) => {
      // M2 sends PATCH /applications with expectedSelectionVersion; locally the
      // version still advances so the optimistic update behaves the same way.
      setRunState((prev) => ({
        ...prev,
        selection: {
          jobIds: ids,
          version: (prev.selection?.version ?? 0) + 1,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [],
  );

  const screen = useMemo(() => {
    const hash = typeof window === "undefined" ? null : window.location.hash;
    return resolveHash(hash, hasRun);
  }, [hasRun]);

  if (!hasRun || screen === "upload") {
    return (
      <Landing
        launchProfile={publicConfig.launchProfile}
        maxUploadBytes={publicConfig.maxUploadBytes}
        error={error}
        onUpload={(file) => startJourney({ fileName: file.name, sample: false })}
        onSample={() => startJourney({ fileName: "sample-resume.pdf", sample: true })}
      />
    );
  }

  return (
    <>
      {isSample && (
        /*
          A sample journey is always visibly identifiable and is excluded from
          live conversion analytics (§3).
        */
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
        onSelectionChange={onSelectionChange}
        onRestart={() => {
          clearTimers();
          setRunState(initialRunState());
          setEdits({});
          setFileName(null);
          setIsSample(false);
          if (typeof window !== "undefined") window.location.hash = SCREEN_HASH.upload;
        }}
      />
    </>
  );
}
