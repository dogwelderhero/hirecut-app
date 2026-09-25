"use client";

/**
 * The persistent workspace: screens 2–6.
 *
 * This component owns the wiring the guide is strict about and nothing else:
 *  - `runState` (events) and `presentation` (timing) are separate machines. The
 *    visible stage comes from the presentation machine, so a fast worker cannot
 *    skip a result the visitor never saw.
 *  - The fourth-click counter is fed from a single delegated click handler on
 *    the main work area, which classifies the gesture and reads the LATEST
 *    selection (sub-rule 5's stale-closure trap) via a ref.
 *  - Bulk Apply stays mounted when preparation finishes. There is no pack, no
 *    dim, and no automatic navigation.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import type { JobId, ScreenId, StageId } from "@/lib/hirecute/contracts";
import { PRESENTATION, type PublicConfig } from "@/lib/hirecute/config";
import {
  exploreReceipt,
  matchReceipt,
  prepareReceipt,
  refineReceipt,
} from "@/lib/hirecute/actions";
import {
  checkoutCounterReducer,
  initialCheckoutCounterState,
  type ClickOrigin,
  type ClickZone,
} from "@/lib/hirecute/checkout-counter";
import { editLetter, type LetterMap } from "@/lib/hirecute/letters";
import { rankByScore } from "@/lib/hirecute/match";
import {
  initialPresentationState,
  isShowingResult,
  presentationReducer,
  visibleStage,
} from "@/lib/hirecute/presentation";
import { screenForStage, showsCreditsBanner } from "@/lib/hirecute/screens";
import type { RunState } from "@/lib/hirecute/run-store";
import { completedStages, selectedJobIds } from "@/lib/hirecute/run-store";
import { AgentTranscript, type StageReceipt } from "./agent-transcript";
import { StageProgress } from "./stage-progress";
import { JobCard } from "./job-card";
import { BulkApply } from "./bulk-apply";
import { CreditsBanner } from "./credits-banner";
import { CheckoutOverlay } from "./checkout-overlay";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Classify a click for the counter. The DOM is the source of truth for *where*
 * the gesture landed, via the `data-hc-zone` / `data-hc-origin` markers the
 * screens set. A label forwarding to its control is detected here because the
 * browser reports it as a `<label>` target.
 */
function classifyClick(target: EventTarget | null): { zone: ClickZone; origin: ClickOrigin } {
  const el = target instanceof Element ? target : null;
  const zone = (el?.closest("[data-hc-zone]")?.getAttribute("data-hc-zone") as ClickZone) ?? "main_work_area";
  const labelHost = el?.closest("label");
  const markedOrigin = el?.closest("[data-hc-origin]")?.getAttribute("data-hc-origin") as
    | ClickOrigin
    | undefined;

  // A click whose target is the <label> itself (not the control inside it) is
  // the forwarded duplicate; the control's own event is the one that counts.
  const isForwardedLabel =
    !!labelHost && el !== null && el.tagName !== "INPUT" && el.tagName !== "BUTTON";

  return {
    zone,
    origin: isForwardedLabel ? "label_forwarded" : (markedOrigin ?? "blank"),
  };
}

export function Workspace({
  runState,
  publicConfig,
  fileName,
  letters,
  onLettersChange,
  onSelectionChange,
  onSaveLetter,
  onRestart,
}: {
  runState: RunState;
  publicConfig: PublicConfig;
  fileName: string | null;
  letters: LetterMap;
  onLettersChange: (next: LetterMap) => void;
  onSelectionChange: (ids: JobId[]) => void;
  /** Persists via PATCH .../jobs/:id/letter with the expected draft version. */
  onSaveLetter: (id: JobId) => void;
  onRestart: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [presentation, dispatchPresentation] = useReducer(
    presentationReducer,
    undefined,
    () => initialPresentationState({ reducedMotion }),
  );
  const [counter, dispatchCounter] = useReducer(
    (s: typeof initialCheckoutCounterState, a: Parameters<typeof checkoutCounterReducer>[1]) =>
      checkoutCounterReducer(s, a).state,
    initialCheckoutCounterState,
  );
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<JobId | null>(null);
  const [savedIds, setSavedIds] = useState<Set<JobId>>(new Set());
  const [expandedId, setExpandedId] = useState<JobId | null>(null);

  const selected = selectedJobIds(runState);
  // Sub-rule 5: the click callback must read the latest selection, never a
  // closure captured at render time.
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const activatedRef = useRef(false);
  activatedRef.current = runState.billing?.status === "activated";

  useEffect(() => {
    dispatchPresentation({ type: "reduced_motion", reducedMotion });
  }, [reducedMotion]);

  // Feed durable stage results into the presentation queue.
  const done = completedStages(runState);
  const doneKey = done.join(",");
  useEffect(() => {
    for (const stage of doneKey ? (doneKey.split(",") as StageId[]) : []) {
      dispatchPresentation({ type: "stage_result", stage });
    }
  }, [doneKey]);

  // Tab visibility pauses the dwell; the backend keeps working.
  useEffect(() => {
    const onVisibility = () =>
      dispatchPresentation({ type: "visibility", foreground: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // A single interval drives the presentation clock.
  useEffect(() => {
    const step = 100;
    const id = setInterval(() => dispatchPresentation({ type: "tick", deltaMs: step }), step);
    return () => clearInterval(id);
  }, []);

  const shownStage = visibleStage(presentation, runState.liveStage);
  const screen: ScreenId = shownStage ? screenForStage(shownStage) : "refine";

  // Default the letter panel to the top-ranked job once ranking exists.
  const ranked = useMemo(() => {
    const withScores = runState.jobOrder.map((id) => ({
      jobId: id,
      score5: runState.assessments[id]?.score5 ?? null,
    }));
    return rankByScore(withScores).map((r) => r.jobId);
  }, [runState.jobOrder, runState.assessments]);

  useEffect(() => {
    if (!activeJobId && ranked.length > 0) setActiveJobId(ranked[0]);
  }, [activeJobId, ranked]);

  /** Delegated handler on the main work area — the only counter input. */
  const onMainClick = useCallback(
    (e: React.MouseEvent) => {
      const { zone, origin } = classifyClick(e.target);
      // Let the underlying card/checkbox/editor/link action commit first, then
      // evaluate eligibility against the settled selection.
      queueMicrotask(() => {
        const result = checkoutCounterReducer(counterRef.current, {
          type: "click",
          context: {
            zone,
            origin,
            onBulkApply: screenRef.current === "bulk_apply",
            selectedCountAfterClick: selectionRef.current.length,
            creditsActivated: activatedRef.current,
          },
        });
        counterRef.current = result.state;
        dispatchCounter({
          type: "click",
          context: {
            zone,
            origin,
            onBulkApply: screenRef.current === "bulk_apply",
            selectedCountAfterClick: selectionRef.current.length,
            creditsActivated: activatedRef.current,
          },
        });
        if (result.scheduleReveal) {
          // Scheduled for the next task, never synchronous with the gesture.
          setTimeout(() => {
            setCheckoutOpen(true);
            dispatchCounter({ type: "reveal_consumed" });
          }, 0);
        }
      });
    },
    [],
  );

  // Mirrors for the microtask callback, which must not capture stale values.
  const counterRef = useRef(counter);
  counterRef.current = counter;
  const screenRef = useRef<ScreenId>(screen);
  screenRef.current = screen;

  const receipts: StageReceipt[] = [];
  const refine = runState.stages.refine?.result;
  if (refine?.kind === "refine" && !isShowingResult(presentation, "refine")) {
    receipts.push({ stage: "refine", label: refineReceipt(refine.changes.length) });
  }
  const explore = runState.stages.explore?.result;
  if (explore?.kind === "explore" && !isShowingResult(presentation, "explore")) {
    receipts.push({
      stage: "explore",
      label: exploreReceipt(explore.jobIds.length, explore.coverage.boardsFailed),
    });
  }
  const match = runState.stages.match?.result;
  if (match?.kind === "match" && !isShowingResult(presentation, "match")) {
    receipts.push({ stage: "match", label: matchReceipt(match.rankedJobIds.length) });
  }
  const prepare = runState.stages.prepare?.result;
  if (prepare?.kind === "prepare") {
    receipts.push({
      stage: "prepare",
      // Marked complete WITHOUT a packing animation (§7).
      label: prepareReceipt(prepare.preparedJobIds.length, prepare.blockedJobIds.length),
    });
  }

  const stageError =
    runState.stages[shownStage ?? "refine"]?.error ?? runState.terminalError ?? null;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      {/* Far-left transcript. Clicks here never count toward checkout. */}
      <div data-hc-zone="agent_sidebar" className="lg:sticky lg:top-6 lg:self-start">
        <AgentTranscript
          fileName={fileName}
          actions={runState.actions}
          receipts={receipts}
          queued={runState.lifecycle === "queued"}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4 text-muted-foreground"
          onClick={() => {
            dispatchCounter({ type: "restart" });
            dispatchPresentation({ type: "reset" });
            onRestart();
          }}
        >
          <RotateCcw className="size-3.5" /> Start over
        </Button>
      </div>

      {/* Main work area — the only zone the counter listens to. */}
      <div data-hc-zone="main_work_area" onClick={onMainClick} className="min-w-0">
        <StageProgress stages={runState.stages} visible={shownStage} className="mb-5" />

        {showsCreditsBanner(screen) && (
          <div className="mb-4">
            <CreditsBanner
              launchProfile={publicConfig.launchProfile}
              includedPackages={publicConfig.maxSelectedPackages}
              hasRankedJob={ranked.some((id) => runState.assessments[id])}
              activated={runState.billing?.status === "activated"}
              onClaim={() => {
                dispatchCounter({ type: "manual_cta" });
                setCheckoutOpen(true);
              }}
            />
          </div>
        )}

        {stageError && (
          /* Inline failure: the stage is kept, completed artifacts are kept. */
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-[var(--hc-danger-soft)] px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 text-[13px]">
              <p className="text-destructive">{stageError.message}</p>
              {stageError.retryable && (
                <Button type="button" size="sm" variant="outline" className="mt-2">
                  Try that step again
                </Button>
              )}
            </div>
          </div>
        )}

        {screen === "refine" && (
          <StageShell title="Finetune Resume" running={!refine}>
            {refine?.kind === "refine" ? (
              <div className="grid gap-3 md:grid-cols-2">
                {refine.changes.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground md:col-span-2">
                    Your resume reads clearly already — the original is kept as-is.
                  </p>
                ) : (
                  refine.changes.map((c) => (
                    <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {c.kind}
                      </div>
                      <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground line-through">
                        {c.before}
                      </p>
                      <p className="mt-1.5 text-[13px] leading-snug whitespace-pre-line">{c.after}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">{c.explanation}</p>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </StageShell>
        )}

        {screen === "explore" && (
          <StageShell title="Explore Jobs" running={!explore}>
            {explore?.kind === "explore" && (
              <>
                <p className="mb-3 text-[13px] text-muted-foreground">
                  {/* The real count and real coverage, never "146". */}
                  {explore.jobIds.length} role{explore.jobIds.length === 1 ? "" : "s"} found across{" "}
                  {explore.coverage.scopeDescription}
                  {explore.coverage.boardsFailed > 0 &&
                    ` · ${explore.coverage.boardsFailed} source${
                      explore.coverage.boardsFailed === 1 ? "" : "s"
                    } could not be checked`}
                </p>
                <div className="flex flex-col gap-2">
                  {runState.jobOrder.map((id) => (
                    <JobCard
                      key={id}
                      job={runState.jobs[id]}
                      saved={savedIds.has(id)}
                      expanded={expandedId === id}
                      onToggleSave={() =>
                        setSavedIds((prev) => {
                          const next = new Set(prev);
                          next.has(id) ? next.delete(id) : next.add(id);
                          return next;
                        })
                      }
                      onToggleExpand={() => setExpandedId((e) => (e === id ? null : id))}
                    />
                  ))}
                </div>
              </>
            )}
          </StageShell>
        )}

        {screen === "matches" && (
          <StageShell title="Top matching jobs" running={!match}>
            {match?.kind === "match" && (
              <div className="flex flex-col gap-2">
                {match.rankedJobIds.map((id) => (
                  <JobCard
                    key={id}
                    job={runState.jobs[id]}
                    assessment={runState.assessments[id]}
                    showMatchPanel
                    saved={savedIds.has(id)}
                    expanded={expandedId === id}
                    onToggleSave={() =>
                      setSavedIds((prev) => {
                        const next = new Set(prev);
                        next.has(id) ? next.delete(id) : next.add(id);
                        return next;
                      })
                    }
                    onToggleExpand={() => setExpandedId((e) => (e === id ? null : id))}
                  />
                ))}
              </div>
            )}
          </StageShell>
        )}

        {/*
          Bulk Apply is mounted whenever the stage is reached and STAYS mounted
          after preparation completes: no pack, no dim, no auto-navigation.
        */}
        {screen === "bulk_apply" && (
          <section>
            <h2 className="font-display mb-3 text-xl">Bulk Apply</h2>
            <BulkApply
              jobs={ranked.map((id) => runState.jobs[id]).filter(Boolean)}
              applications={runState.applications}
              assessments={runState.assessments}
              selectedIds={selected}
              activeJobId={activeJobId}
              letters={letters}
              launchProfile={publicConfig.launchProfile}
              preparing={runState.stages.prepare?.status === "running"}
              onSelectJob={setActiveJobId}
              onToggleInclude={(id, included) =>
                onSelectionChange(
                  included ? [...new Set([...selected, id])] : selected.filter((s) => s !== id),
                )
              }
              onEditLetter={(id, text) => onLettersChange(editLetter(letters, id, text))}
              onSaveLetter={onSaveLetter}
            />
          </section>
        )}
      </div>

      <CheckoutOverlay
        open={checkoutOpen}
        billing={runState.billing}
        launchProfile={publicConfig.launchProfile}
        selectedCount={selected.length}
        includedPackages={publicConfig.maxSelectedPackages}
        reducedMotion={reducedMotion}
        stripeConfigured={Boolean(publicConfig.stripePublishableKey)}
        onClose={() => {
          setCheckoutOpen(false);
          dispatchCounter({ type: "modal_closed" });
        }}
        onStartSetup={() => {
          /* Milestone 7 wires POST /api/hirecute/billing/setup here. */
        }}
      />
    </div>
  );
}

function StageShell({
  title,
  running,
  children,
}: {
  title: string;
  running: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-display mb-3 flex items-center gap-2 text-xl">
        {title}
        {running && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </h2>
      {running ? (
        /* Indeterminate: §2 allows a percentage bar only with known counts. */
        <div className={cn("job-indeterminate h-[3px] w-full rounded-full bg-border")} />
      ) : (
        children
      )}
    </section>
  );
}

/** `prefers-reduced-motion`, watched live. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export { PRESENTATION };
