"use client";

/**
 * The persistent workspace — screens 03/05/07/09 plus the checkout overlay.
 *
 * Ported to the reference shell: `div.hc-shell.hc-shell--conversation` wrapping
 * the conversation sidebar and `main.hc-main` > `nav.hc-stepper` +
 * `section.hc-work` > `section.hc-agent-stage`, which holds either
 * `div.hc-stage-working` or `div.hc-stage-result`.
 *
 * The behavioural wiring is unchanged from before the design port:
 *  - `runState` (events) and `presentation` (timing) stay separate machines, so
 *    a fast worker cannot skip a result the visitor never saw.
 *  - The fourth-click counter is fed by one delegated handler on the main work
 *    area, reading the LATEST selection through a ref (sub-rule 5's stale
 *    closure trap).
 *  - Bulk Apply stays mounted when preparation finishes: no pack, no dim, no
 *    automatic navigation.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type {
  JobId,
  ScreenId,
  SearchPreferences,
  StageId,
} from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
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
import { displayText, editLetter, type LetterMap } from "@/lib/hirecute/letters";
import { matchPresentation, rankByScore } from "@/lib/hirecute/match";
import {
  initialPresentationState,
  isPacking,
  isShowingResult,
  presentationReducer,
  visibleStage,
} from "@/lib/hirecute/presentation";
import { STAGE_ORDER, screenForStage, showsCreditsBanner } from "@/lib/hirecute/screens";
import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";
import type { RunState } from "@/lib/hirecute/run-store";
import { completedStages, selectedJobIds } from "@/lib/hirecute/run-store";
import { AgentTranscript, type StageReceipt } from "./agent-transcript";
import { StageProgress } from "./stage-progress";
import { ExploreResults, MatchResults } from "./search-results";
import { BulkApply } from "./bulk-apply";
import { CreditsBanner } from "./credits-banner";
import { CheckoutOverlay } from "./checkout-overlay";

/**
 * The reference's `div.hc-stage-save[role=status]` — the ~780ms packing
 * announcement between a result's 2s hold and its receipt landing in the
 * chat. `aria-live` so it also reaches screen readers, not just sighted users.
 */
function PackingStatus() {
  return (
    <div className="hc-stage-save" role="status" aria-live="polite">
      <i className="hc-dot" />
      <span>Result ready · Saving to your chat…</span>
    </div>
  );
}

/** Classify a click for the counter, from the `data-hc-*` markers screens set. */
function classifyClick(target: EventTarget | null): { zone: ClickZone; origin: ClickOrigin } {
  const el = target instanceof Element ? target : null;
  const zone =
    (el?.closest("[data-hc-zone]")?.getAttribute("data-hc-zone") as ClickZone) ?? "main_work_area";
  const labelHost = el?.closest("label");
  const markedOrigin = el?.closest("[data-hc-origin]")?.getAttribute("data-hc-origin") as
    | ClickOrigin
    | undefined;
  // A click whose target is the <label> itself is the forwarded duplicate; the
  // control's own event is the one that counts.
  const isForwardedLabel =
    !!labelHost && el !== null && el.tagName !== "INPUT" && el.tagName !== "BUTTON";
  return { zone, origin: isForwardedLabel ? "label_forwarded" : (markedOrigin ?? "blank") };
}

/** `header.hc-heading` + `div.hc-pill`, the reference's stage header. */
function StageHeading({
  step,
  name,
  title,
  lead,
  pill,
}: {
  step: string;
  name: string;
  title: string;
  lead: string;
  pill: string;
}) {
  return (
    <header className="hc-heading">
      <div>
        <div className="hc-label">
          Step {step} · {name}
        </div>
        <h1>{title}</h1>
        <p>{lead}</p>
      </div>
      <div className="hc-pill">
        {/* `i.hc-dot` is the reference's live indicator; CSS animates it. */}
        <i className="hc-dot" />
        <span>{pill}</span>
      </div>
    </header>
  );
}

/**
 * The reference's working panel: `div.hc-panel` > `div.hc-loading-layout` >
 * `div.hc-loading-visual` + `div.hc-loading-copy`, then `div.hc-stage-footer`.
 *
 * Each stage brings its own visual and its own lead copy (the reference screens
 * differ: 03 scans a document, 05 shows the query, 07 counts roles), so both
 * sides are slots. The checklist and the progress bar are shared.
 */
function WorkingPanel({
  visual,
  title,
  lead,
  actions,
  footer,
  aside,
  tag,
  meta,
}: {
  visual: React.ReactNode;
  title: string;
  lead: string;
  actions: { label: string; status: string }[];
  footer: string;
  /** Replaces the checklist when a stage shows per-source rows instead. */
  aside?: React.ReactNode;
  /** The reference's file-name chip above the copy heading (screen 03). */
  tag?: string;
  /** The reference's `Step N of 4 / …starts automatically` row (screen 03 only). */
  meta?: [string, string];
}) {
  return (
    <>
      <div className="hc-panel">
        <div className="hc-loading-layout">
          <div className="hc-loading-visual">{visual}</div>
          <div className="hc-loading-copy">
            {tag && <span className="hc-tag">{tag}</span>}
            <h2 className={tag ? "hc-space-top" : undefined}>{title}</h2>
            <p>{lead}</p>
            {aside ?? (
              <div className="hc-checklist">
                {actions.map((a) => (
                  <div key={a.label}>
                    <span
                      className={a.status === "pending" ? "hc-muted" : "hc-green"}
                      aria-hidden
                    >
                      {a.status === "completed" ? "✓" : a.status === "in_progress" ? "●" : "○"}
                    </span>
                    <span className={a.status === "pending" ? "hc-muted" : undefined}>
                      {a.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/*
              Indeterminate. The reference hardcodes a fill width
              (`hc-progress--half`, `--most`); §2 allows a determinate bar only
              against a known total, and an action list that grows as work
              starts is not one.
            */}
            <div className="hc-progress hc-space-top" />
            {meta && (
              <div className="hc-row hc-between hc-space-top">
                <span className="hc-tiny hc-muted">{meta[0]}</span>
                <span className="hc-tiny hc-muted">{meta[1]}</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="hc-stage-footer">
        <span className="hc-small hc-muted">{footer}</span>
      </div>
    </>
  );
}

/** Screen 03's visual: a skeleton document under a moving scan line. */
function DocScanVisual({ caption }: { caption: string }) {
  return (
    <article className="hc-doc hc-doc--skeleton">
      <div className="hc-skel hc-skel--title" />
      <div className="hc-skel hc-skel--short" />
      <hr className="hc-divider" />
      <div className="hc-skel" />
      <div className="hc-skel hc-skel--mid" />
      <div className="hc-skel hc-skel--short" />
      <div className="hc-scan" />
      <div className="hc-skel" />
      <div className="hc-skel hc-skel--mid" />
      <div className="hc-skel" />
      <p>{caption}</p>
    </article>
  );
}

/** Screen 05's visual: the real search query, never an invented one. */
function QueryVisual({ preferences }: { preferences: SearchPreferences | null }) {
  const roles = (preferences?.targetRoles ?? []).join(" · ");
  const places = (preferences?.locations ?? []).join(" / ");
  const query = [roles, places].filter(Boolean).join(" · ");
  return (
    <>
      <div className="hc-ring">
        <svg
          className="hc-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 5 5" />
        </svg>
      </div>
      <h2>Searching with your priorities</h2>
      <div className="hc-query hc-space-top">
        {/*
          Derived from the resume, so it can be thin. The reference's
          "£65k–£85k · Mid / senior · B2B SaaS" chips are omitted: we hold no
          salary, seniority or industry preference, and §5 forbids inventing
          one to fill the row.
        */}
        <span>{query || "Roles your experience supports"}</span>
      </div>
      {(preferences?.workStyles.length ?? 0) > 0 && (
        <div className="hc-row hc-space-top">
          {preferences?.workStyles.map((w) => (
            <span key={w} className="hc-tag">
              {w === "remote" ? "Remote" : w === "hybrid" ? "Hybrid" : "On-site"}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Screen 05's copy side: one row per provider, with real board counts. */
function SourceRows() {
  const byProvider = CURATED_BOARDS.reduce<Record<string, number>>((acc, b) => {
    acc[b.provider] = (acc[b.provider] ?? 0) + 1;
    return acc;
  }, {});
  const label: Record<string, string> = {
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
    workday: "Workday",
  };
  return (
    <div className="hc-stack hc-space-top">
      {Object.entries(byProvider).map(([provider, count]) => (
        <div key={provider} className="hc-source">
          <span>{label[provider] ?? provider}</span>
          {/*
            The reference shows a per-source found count ("38 found") while the
            search is still running. We only learn per-board results when the
            stage reports coverage, so the row states what it is doing instead
            of a number we do not have yet.
          */}
          <span className="hc-tag">
            {count} {count === 1 ? "board" : "boards"} · searching…
          </span>
        </div>
      ))}
    </div>
  );
}

/** Screen 07's visual: the ring, carrying a real count. */
function CountRingVisual({
  count,
  caption,
  note,
  tags,
}: {
  count: number | null;
  caption: string;
  note: string;
  tags: string[];
}) {
  return (
    <>
      <div className="hc-ring">
        {/* No placeholder digit: an unknown count shows the spinner alone. */}
        {count === null ? <span aria-hidden>·</span> : <span>{count}</span>}
      </div>
      <h2>{caption}</h2>
      <p className="hc-muted hc-small hc-space-top">{note}</p>
      <div className="hc-row hc-space-top">
        {tags.map((t) => (
          <span key={t} className="hc-tag">
            {t}
          </span>
        ))}
      </div>
    </>
  );
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
  onSaveLetter: (id: JobId) => void;
  onRestart: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [presentation, dispatchPresentation] = useReducer(presentationReducer, undefined, () =>
    initialPresentationState({ reducedMotion }),
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
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const activatedRef = useRef(false);
  activatedRef.current = runState.billing?.status === "activated";
  const counterRef = useRef(counter);
  counterRef.current = counter;

  useEffect(() => {
    dispatchPresentation({ type: "reduced_motion", reducedMotion });
  }, [reducedMotion]);

  const done = completedStages(runState);
  const doneKey = done.join(",");
  useEffect(() => {
    for (const stage of doneKey ? (doneKey.split(",") as StageId[]) : []) {
      dispatchPresentation({ type: "stage_result", stage });
    }
  }, [doneKey]);

  useEffect(() => {
    const onVisibility = () =>
      dispatchPresentation({ type: "visibility", foreground: !document.hidden });
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    const step = 100;
    const id = setInterval(() => dispatchPresentation({ type: "tick", deltaMs: step }), step);
    return () => clearInterval(id);
  }, []);

  const shownStage = visibleStage(presentation, runState.liveStage);
  const screen: ScreenId = shownStage ? screenForStage(shownStage) : "refine";
  const screenRef = useRef<ScreenId>(screen);
  screenRef.current = screen;

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
  const onMainClick = useCallback((e: React.MouseEvent) => {
    const { zone, origin } = classifyClick(e.target);
    // Let the underlying action commit first, then evaluate eligibility
    // against the settled selection.
    queueMicrotask(() => {
      const context = {
        zone,
        origin,
        onBulkApply: screenRef.current === "bulk_apply",
        selectedCountAfterClick: selectionRef.current.length,
        creditsActivated: activatedRef.current,
      };
      const result = checkoutCounterReducer(counterRef.current, { type: "click", context });
      counterRef.current = result.state;
      dispatchCounter({ type: "click", context });
      if (result.scheduleReveal) {
        // Scheduled for the next task, never synchronous with the gesture.
        setTimeout(() => {
          setCheckoutOpen(true);
          dispatchCounter({ type: "reveal_consumed" });
        }, 0);
      }
    });
  }, []);

  const toggleSave = (id: JobId) =>
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Receipts, built from real counts ────────────────────────────────────
  const refine = runState.stages.refine?.result;
  const explore = runState.stages.explore?.result;
  const match = runState.stages.match?.result;
  const prepare = runState.stages.prepare?.result;

  /*
    The reference's Bulk Apply screen opens with the first row of the batch
    already selected and its letter showing on the right — never the empty
    "Select a role" placeholder. `activeJobId` is set once, above, from
    `ranked[0]` (the single best-scored job across every explored role), but
    the batch below is the *selected* subset, which is not always ordered the
    same way and does not always contain that job. When it doesn't, fall back
    to the batch's own first row so the panel is never empty on arrival.
  */
  const batchJobIds =
    prepare?.kind === "prepare"
      ? [...prepare.preparedJobIds, ...prepare.blockedJobIds, ...prepare.failedJobIds]
      : selected;
  const batchKey = batchJobIds.join(",");
  useEffect(() => {
    if (screenRef.current !== "bulk_apply") return;
    const ids = batchKey ? batchKey.split(",") : [];
    if (ids.length === 0) return;
    if (activeJobId && ids.includes(activeJobId)) return;
    setActiveJobId(ids[0] as JobId);
    // `batchKey` is the id list serialized; `screen` (not just its ref) must
    // also gate this so arriving at the screen re-checks even if the key
    // hasn't changed since the last visit.
  }, [batchKey, screen, activeJobId]);

  const receipts: StageReceipt[] = [];
  if (refine?.kind === "refine" && !isShowingResult(presentation, "refine")) {
    receipts.push({
      stage: "refine",
      label: "Resume refined",
      detail: refineReceipt(refine.changes.length).replace(/^Resume (refined|reviewed) · /, ""),
    });
  }
  if (explore?.kind === "explore" && !isShowingResult(presentation, "explore")) {
    receipts.push({
      stage: "explore",
      label: `${explore.jobIds.length} roles saved`,
      detail: exploreReceipt(explore.jobIds.length, explore.coverage.boardsFailed).replace(
        /^\d+ roles? saved · /,
        "",
      ),
    });
  }
  if (match?.kind === "match" && !isShowingResult(presentation, "match")) {
    receipts.push({
      stage: "match",
      label: `${match.rankedJobIds.length} top matches saved`,
      detail: matchReceipt(match.rankedJobIds.length).replace(/^.*saved · /, ""),
    });
  }
  if (prepare?.kind === "prepare") {
    receipts.push({
      stage: "prepare",
      // Marked complete WITHOUT a packing animation (§7).
      label: prepareReceipt(prepare.preparedJobIds.length, prepare.blockedJobIds.length),
    });
  }

  const nextStage: StageId | null = useMemo(() => {
    const i = shownStage ? STAGE_ORDER.indexOf(shownStage) : -1;
    if (i < 0 || i >= STAGE_ORDER.length - 1) return null;
    return runState.stages[shownStage!]?.status === "completed" ? STAGE_ORDER[i + 1] : null;
  }, [shownStage, runState.stages]);

  const stageError = runState.stages[shownStage ?? "refine"]?.error ?? runState.terminalError ?? null;
  const stageActions = (stage: StageId) =>
    runState.actions
      .filter((a) => a.stage === stage)
      .map((a) => ({ label: a.label, status: a.status }));

  return (
    <>
      {/*
        The reference screen renders a SECOND, inert copy of the shell inside
        `div.hc-credit-background` to sit blurred behind the dialog. Rendering
        the workspace twice in React would duplicate its live state, so the
        real shell takes that class while checkout is open — same fixed,
        blurred, pointer-events:none result, one instance. The dialog must stay
        a sibling: a CSS `filter` blurs descendants, so nesting it here would
        blur the checkout form too.
      */}
      <div
        className={`hc-shell hc-shell--conversation${
          checkoutOpen ? " hc-credit-background" : ""
        }`}
        /* The CSS already sets pointer-events:none; this is the a11y half. */
        inert={checkoutOpen}
      >
      <AgentTranscript
        fileName={fileName}
        actions={runState.actions}
        receipts={receipts}
        queued={runState.lifecycle === "queued"}
        liveStage={runState.liveStage}
        nextStage={nextStage}
      />

      {/* Main work area — the only zone the fourth-click counter listens to. */}
      <main className="hc-main" data-hc-zone="main_work_area" onClick={onMainClick}>
        {/* The reference puts the banner first in `main`, above the stepper. */}
        {showsCreditsBanner(screen) && (
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
        )}

        <StageProgress stages={runState.stages} visible={shownStage} />

        <section className="hc-work">
          {stageError && (
            /* Inline failure: the stage and its completed artifacts are kept. */
            <div className="hc-panel hc-danger-panel" role="alert">
              <p>{stageError.message}</p>
              {stageError.retryable && (
                <button type="button" className="hc-button hc-button--quiet">
                  <span>Try that step again</span>
                </button>
              )}
            </div>
          )}

          {/* ── Screen 03 — Finetune Resume ────────────────────────────── */}
          {screen === "refine" && (
            <section className="hc-agent-stage">
              {refine?.kind !== "refine" ? (
                <div className="hc-stage-working">
                  <StageHeading
                    step="01"
                    name="Finetune Resume"
                    title="You have a good story. Let’s sharpen it."
                    lead="Your agent is turning your experience into a resume that reads clearly."
                    pill="Agent is working"
                  />
                  <WorkingPanel
                    visual={<DocScanVisual caption="Finding the story in your experience" />}
                    tag={fileName ?? undefined}
                    title="Making your experience stand out"
                    lead="We keep the facts. We improve the structure, language and focus."
                    actions={stageActions("refine")}
                    footer="Your original resume is always kept."
                    meta={["Step 1 of 4", "Finetuning starts automatically"]}
                  />
                </div>
              ) : (
                <div className={`hc-stage-result${isPacking(presentation, "refine") ? " is-packing" : ""}`}>
                  <StageHeading
                    step="01"
                    name="Finetune Resume"
                    title="Same experience. A stronger first impression."
                    lead="Review the changes. Your facts, voice and original file stay intact."
                    pill="Resume ready"
                  />
                  {/*
                    Real counts. §4: "do not hardcode '8 improvements,'
                    '3 bullet points clarified' or '0 facts invented'." The
                    third metric in the reference claims zero invented facts as
                    a guarantee; the fact checker is a heuristic, so it is
                    replaced with what we can actually stand behind.
                  */}
                  <div className="hc-grid3 hc-space-bottom">
                    <div className="hc-metric">
                      <strong>{refine.changes.length}</strong>
                      <span>Improvements made</span>
                    </div>
                    <div className="hc-metric">
                      <strong>
                        {refine.changes.filter((c) => c.kind === "clarity").length}
                      </strong>
                      <span>Bullet points clarified</span>
                    </div>
                    <div className="hc-metric">
                      <strong>✓</strong>
                      <span>Original kept</span>
                    </div>
                  </div>

                  <div className="hc-grid2">
                    <div className="hc-panel">
                      <div className="hc-panel-head">
                        <span className="hc-label">YOUR ORIGINAL</span>
                        <span className="hc-tag">Saved</span>
                      </div>
                      <article className="hc-doc">
                        {refine.changes.map((c) => (
                          <p key={`${c.id}-before`} className="hc-muted">
                            {c.before}
                          </p>
                        ))}
                      </article>
                    </div>
                    <div className="hc-panel">
                      <div className="hc-panel-head">
                        <span className="hc-label">REFINED BY HIRECUTE</span>
                        <span className="hc-tag hc-tag--green">✓ Ready to review</span>
                      </div>
                      <article className="hc-doc">
                        {refine.changes.map((c) => (
                          <p key={`${c.id}-after`}>{c.after}</p>
                        ))}
                      </article>
                    </div>
                  </div>
                  <div className="hc-stage-footer">
                    <span className="hc-small hc-muted">
                      Saved in your agent conversation. Your original resume is always kept.
                    </span>
                  </div>
                </div>
              )}
              {isPacking(presentation, "refine") && <PackingStatus />}
            </section>
          )}

          {/* ── Screen 05 — Explore Jobs ───────────────────────────────── */}
          {screen === "explore" && (
            <section className="hc-agent-stage">
              {explore?.kind !== "explore" ? (
                <div className="hc-stage-working">
                  <StageHeading
                    step="02"
                    name="Explore Jobs"
                    title="Let’s see what’s out there."
                    lead="Searching for roles that fit your experience and the way you want to work."
                    /* The real number of boards, not the reference's "4 sources". */
                    pill={`Searching ${CURATED_BOARDS.length} boards`}
                  />
                  <WorkingPanel
                    visual={<QueryVisual preferences={runState.snapshot?.preferences ?? null} />}
                    title="A wider search. A tighter fit."
                    lead="Your agent reads each board's own postings, removes duplicates and drops listings it cannot date."
                    actions={stageActions("explore")}
                    aside={<SourceRows />}
                    footer="Your search preferences are applied to every source."
                  />
                </div>
              ) : (
                <div className={`hc-stage-result${isPacking(presentation, "explore") ? " is-packing" : ""}`}>
                  <ExploreResults
                    jobs={runState.jobs}
                    order={runState.jobOrder}
                    assessments={runState.assessments}
                    savedIds={savedIds}
                    expandedId={expandedId}
                    onToggleSave={toggleSave}
                    onToggleExpand={(id) => setExpandedId((e) => (e === id ? null : id))}
                    coverage={explore.coverage}
                    preferences={runState.snapshot?.preferences ?? null}
                  />
                </div>
              )}
              {isPacking(presentation, "explore") && <PackingStatus />}
            </section>
          )}

          {/* ── Screen 07 — Top matching jobs ──────────────────────────── */}
          {screen === "matches" && (
            <section className="hc-agent-stage">
              {match?.kind !== "match" ? (
                <div className="hc-stage-working">
                  <StageHeading
                    step="03"
                    name="Top matching jobs"
                    title="Looking for your kind of role."
                    lead="Comparing every opening with your skills, experience and priorities."
                    pill="Matching in progress"
                  />
                  <WorkingPanel
                    visual={
                      <CountRingVisual
                        /* The real number of discovered roles being compared. */
                        count={runState.jobOrder.length > 0 ? runState.jobOrder.length : null}
                        caption="Roles being compared"
                        note="One shortlist built around you."
                        tags={["Experience", "Skills", "Preferences"]}
                      />
                    }
                    title="More than a keyword match."
                    lead="Your agent looks at what you’ve actually done, what the role asks for, and what you want next."
                    actions={stageActions("match")}
                    footer="Every match comes with a reason."
                  />
                </div>
              ) : (
                <div className={`hc-stage-result${isPacking(presentation, "match") ? " is-packing" : ""}`}>
                  <MatchResults
                    jobs={runState.jobs}
                    order={runState.jobOrder}
                    rankedIds={match.rankedJobIds}
                    assessments={runState.assessments}
                    savedIds={savedIds}
                    expandedId={expandedId}
                    onToggleSave={toggleSave}
                    onToggleExpand={(id) => setExpandedId((e) => (e === id ? null : id))}
                  />
                  {/* §6: the percentage is a profile match, not a probability. */}
                  <p className="hc-match-legend">
                    {matchPresentation({ score5: 5 })?.explanation}
                  </p>
                </div>
              )}
              {isPacking(presentation, "match") && <PackingStatus />}
            </section>
          )}

          {/* ── Screen 09 — Bulk Apply ─────────────────────────────────── */}
          {screen === "bulk_apply" && (
            <section className="hc-agent-stage hc-application-stage">
              <div className="hc-stage-result">
                <div className="hc-application-preview">
                  <header className="hc-sr-heading">
                    <div>
                      <div className="hc-sr-eyebrow">STEP 04 · BULK APPLY</div>
                      <h1>Your next move, made personal.</h1>
                      <p>
                        Tailored applications. Personal introductions. Your agent is putting it
                        all together.
                      </p>
                    </div>
                    <div className="hc-sr-complete">
                      <i />
                      <span>
                        {runState.stages.prepare?.status === "running"
                          ? "Preparing your applications"
                          : "Ready for your approval"}
                      </span>
                    </div>
                  </header>
                </div>
                <BulkApply
                  /*
                    Only roles this stage actually covers. Ranking produces
                    every discovered job, but prepare works the selected batch
                    — listing all of them left thirty rows reading "Preparing
                    application…" for work that was never queued.
                  */
                  jobs={batchJobIds.map((id) => runState.jobs[id]).filter(Boolean)}
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
                      included
                        ? [...new Set([...selected, id])]
                        : selected.filter((s) => s !== id),
                    )
                  }
                  onEditLetter={(id, text) => onLettersChange(editLetter(letters, id, text))}
                  onSaveLetter={onSaveLetter}
                  onClaimCredits={() => {
                    dispatchCounter({ type: "manual_cta" });
                    setCheckoutOpen(true);
                  }}
                />
              </div>
            </section>
          )}
        </section>

        <footer className="hc-work-footer">
          <span>hirecute · your job search, with a little help</span>
          <button type="button" className="hc-button hc-button--quiet" onClick={onRestart}>
            <span>Start over</span>
          </button>
        </footer>
      </main>
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
    </>
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

export { displayText };
