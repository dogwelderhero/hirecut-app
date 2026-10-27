"use client";

/**
 * The journey workspace: one page, four agent steps, no Next buttons.
 *
 *   1. Reading your resume      — the resume block, sections loading, then read
 *   2. Finding jobs & gaps      — jobs stream in, get scored, gaps collect live
 *   3. Improving your resume    — changes built from those gaps, with evidence
 *   4. Talk to a recruiter      — recruiters for the gaps; Book / Download → paywall
 *
 * Rules (02-screen-guide.md §2, adapted to these steps):
 *  - Left: the agent's actions, one at a time, grouped by step; finished steps
 *    collapse into a receipt. Right: the live outcome of the step on screen.
 *  - Steps 1 and 2 keep their result on screen for the foreground dwell, pack
 *    it into the receipt, then the next step shows. Nobody presses Next.
 *  - Step 3 is where the visitor first acts: it never packs away. Step 4 opens
 *    beside it as soon as the agent has finished step 3.
 *  - Timers only animate. Work, results and counts come from the run.
 */

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { JobId, ResumeGap, ScreenId, StageId } from "@/lib/hirecute/contracts";
import type { PublicConfig } from "@/lib/hirecute/config";
import type { LetterMap } from "@/lib/hirecute/letters";
import {
  initialPresentationState,
  isPacking,
  isShowingResult,
  presentationReducer,
  visibleStage,
} from "@/lib/hirecute/presentation";
import { screenForStage } from "@/lib/hirecute/screens";
import { CURATED_BOARDS } from "@/lib/hirecute/boards.mjs";
import type { RunState } from "@/lib/hirecute/run-store";
import { completedStages } from "@/lib/hirecute/run-store";
import { collectGaps } from "@/lib/hirecute/evidence.mjs";
import { toggleExclusion } from "@/lib/hirecute/resume.mjs";
import { AgentTranscript, type LocalStep, type StageReceipt } from "./agent-transcript";
import { StageProgress } from "./stage-progress";
import { ResumeReview } from "./resume-review";
import { JobsLive } from "./jobs-live";
import { RecruiterStep } from "./recruiter-step";
import { pickRecruiters } from "./recruiters";
import { ImprovePanel } from "./improve-panel";
import { CvPreview } from "./cv-preview";
import { CheckoutOverlay } from "./checkout-overlay";

/** The ~780ms packing announcement between a result's dwell and its receipt. */
function PackingStatus() {
  return (
    <div className="hc-stage-save" role="status" aria-live="polite">
      <i className="hc-dot" />
      <span>Result ready · Saving to your chat…</span>
    </div>
  );
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
        <i className="hc-dot" />
        <span>{pill}</span>
      </div>
    </header>
  );
}

export function Workspace({
  runState,
  publicConfig,
  fileName,
  onRestart,
}: {
  runState: RunState;
  publicConfig: PublicConfig;
  fileName: string | null;
  letters: LetterMap;
  onLettersChange: (next: LetterMap) => void;
  onSelectionChange: (ids: JobId[]) => void;
  onSaveLetter: (id: JobId) => void;
  onAcceptResume: (appliedRecommendationIds: string[], excludedItems: string[]) => Promise<boolean>;
  onRestart: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [presentation, dispatchPresentation] = useReducer(presentationReducer, undefined, () =>
    initialPresentationState({ reducedMotion }),
  );
  const [applied, setApplied] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  /** The visitor went back from the preview to change their choices. */
  const [editing, setEditing] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const closePaywall = useCallback(() => setPaywallOpen(false), []);

  useEffect(() => {
    dispatchPresentation({ type: "reduced_motion", reducedMotion });
  }, [reducedMotion]);

  // Each durable stage result is queued for presentation exactly once.
  const doneKey = completedStages(runState).join(",");
  useEffect(() => {
    for (const stage of doneKey ? (doneKey.split(",") as StageId[]) : []) {
      dispatchPresentation({ type: "stage_result", stage });
    }
  }, [doneKey]);

  // Hidden tabs pause the dwell; backend work carries on.
  useEffect(() => {
    const onVisibility = () => dispatchPresentation({ type: "visibility", foreground: !document.hidden });
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

  const refine = runState.stages.refine?.result;
  const explore = runState.stages.explore?.result;
  const match = runState.stages.match?.result;
  const improve = runState.stages.improve?.result;

  const resume = refine?.kind === "refine" ? refine.resume : runState.parsedResume;
  const improveDone = improve?.kind === "improve";
  const gaps: ResumeGap[] = improveDone
    ? improve.gaps
    : collectGaps(Object.values(runState.assessments), runState.jobs);
  const recommendations = improveDone ? improve.recommendations : null;
  const toggleApplied = (id: string) => {
    setSkipped((p) => p.filter((x) => x !== id));
    setApplied((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const answered = new Set((recommendations ?? []).flatMap((r) => r.gapIds ?? []));
  const openGaps = gaps.filter((g) => !answered.has(g.id));

  // Step 3 → 4: once every change is applied (or skipped), the updated resume
  // and the recruiters open. A short beat lets the last "applied" register.
  const recs = recommendations ?? [];
  const allDecided = improveDone && recs.every((r) => applied.includes(r.id) || skipped.includes(r.id));
  const [cvReady, setCvReady] = useState(false);
  useEffect(() => {
    if (!allDecided || editing) {
      setCvReady(false);
      return;
    }
    const t = setTimeout(() => setCvReady(true), recs.length === 0 ? 0 : 1200);
    return () => clearTimeout(t);
  }, [allDecided, editing, recs.length]);
  const recruiterActive = cvReady && screen === "improve";

  const topJobIds = useMemo(() => {
    const ranked = match?.kind === "match" ? match.rankedJobIds : [];
    const ids = ranked.length
      ? ranked
      : Object.keys(runState.assessments).sort(
          (a, b) => runState.assessments[b].score5 - runState.assessments[a].score5,
        );
    return ids.filter((id) => runState.jobs[id]).slice(0, 3);
  }, [match, runState.assessments, runState.jobs]);
  const recruiters = useMemo(() => {
    const titles = Object.values(runState.jobs).map((j) => j.title);
    const text = [resume?.targetTitle, resume?.summary, ...(resume?.experience ?? []).map((e) => e.role), ...titles]
      .filter(Boolean)
      .join(" ");
    return pickRecruiters(text, 3);
  }, [resume, runState.jobs]);
  const recruiterStep: LocalStep | null = recruiterActive
    ? {
        done: true,
        actions: [
          { id: "rs-0", label: "Matching you with recruiters who hire in your field", status: "completed" },
          {
            id: "rs-1",
            label: `${recruiters.length} recruiters ready for a quick call`,
            status: "completed",
          },
        ],
      }
    : null;

  // ── Receipts (counts from real results) ─────────────────────────────────
  const scoredCount = Object.keys(runState.assessments).length;
  const receipts: StageReceipt[] = [];
  if (refine?.kind === "refine" && !isShowingResult(presentation, "refine")) {
    receipts.push({ stage: "refine", label: "Resume read", detail: "Every section mapped · Original kept" });
  }
  if (match?.kind === "match" && !isShowingResult(presentation, "match")) {
    const jobCount = explore?.kind === "explore" ? explore.jobIds.length : runState.jobOrder.length;
    receipts.push({
      stage: "match",
      label: `${scoredCount} of ${jobCount} jobs scored`,
      detail: `${gaps.length} gap${gaps.length === 1 ? "" : "s"} found · Quotes included`,
    });
  }
  if (improveDone) {
    receipts.push({
      stage: "improve",
      label: `${improve.recommendations.length} change${improve.recommendations.length === 1 ? "" : "s"} suggested`,
      detail: `${openGaps.length} gap${openGaps.length === 1 ? "" : "s"} to discuss with a recruiter`,
    });
  }

  const nextStage: StageId | null = useMemo(() => {
    if (!shownStage || runState.stages[shownStage]?.status !== "completed") return null;
    const next: Partial<Record<StageId, StageId>> = { refine: "match", explore: "match", match: "improve" };
    return next[shownStage] ?? null;
  }, [shownStage, runState.stages]);

  const stageError = runState.stages[shownStage ?? "refine"]?.error ?? runState.terminalError ?? null;
  const searching = runState.stages.explore?.status === "running" || runState.liveStage === "explore";
  const scoring = runState.stages.match?.status === "running";

  return (
    <>
      <div
        className={`hc-shell hc-shell--conversation${paywallOpen ? " hc-credit-background" : ""}`}
        inert={paywallOpen}
      >
        <AgentTranscript
          fileName={fileName}
          actions={runState.actions}
          receipts={receipts}
          queued={runState.lifecycle === "queued"}
          liveStage={runState.liveStage}
          nextStage={nextStage}
          recruiterStep={recruiterStep}
        />

        <main className="hc-main" data-hc-zone="main_work_area">
          <StageProgress stages={runState.stages} visible={shownStage ?? "refine"} recruiterActive={recruiterActive} />

          <section className="hc-work">
            {stageError && (
              <div className="hc-panel hc-danger-panel" role="alert">
                <p>{stageError.message}</p>
              </div>
            )}

            {/* ── Step 1 — Reading your resume ─────────────────────────── */}
            {screen === "refine" && (
              <section className="hc-agent-stage">
                <StageHeading
                  step="01"
                  name="Reading your resume"
                  title={resume ? "Your experience, mapped." : "Reading your resume."}
                  lead={
                    resume
                      ? "Every section and role is mapped. Next, your agent finds jobs that fit."
                      : "Your agent is mapping every section and role. Nothing is changed at this step."
                  }
                  pill={refine?.kind === "refine" ? "Resume read" : "Agent is working"}
                />
                <div className={`hc-stage-result hc-step-single${isPacking(presentation, "refine") ? " is-packing" : ""}`}>
                  <ResumeReview
                    phase="read"
                    resume={resume}
                    recommendations={[]}
                    recommendationsAvailable
                    appliedIds={[]}
                    excludedItems={[]}
                    locked
                    onToggleRecommendation={() => {}}
                    onToggleItem={() => {}}
                  />
                </div>
                {isPacking(presentation, "refine") && <PackingStatus />}
              </section>
            )}

            {/* ── Step 2 — Finding jobs & gaps ─────────────────────────── */}
            {screen === "matches" && (
              <section className="hc-agent-stage">
                <StageHeading
                  step="02"
                  name="Finding jobs & gaps"
                  title={match?.kind === "match" ? "Here’s where you stand." : "Finding jobs that fit you."}
                  lead={
                    searching
                      ? "Your agent is checking company career pages for roles that fit your experience."
                      : "Your agent reads every job and quotes what it asks for, next to what your resume shows."
                  }
                  pill={match?.kind === "match" ? "Jobs scored" : searching ? "Searching" : "Reading jobs"}
                />
                <div className={`hc-stage-result${isPacking(presentation, "match") ? " is-packing" : ""}`}>
                  <JobsLive
                    jobs={runState.jobs}
                    order={explore?.kind === "explore" ? explore.jobIds : runState.jobOrder}
                    assessments={runState.assessments}
                    searching={searching}
                    scoring={scoring}
                    boardCount={CURATED_BOARDS.length}
                    error={runState.stages.explore?.error ?? null}
                  />
                </div>
                {isPacking(presentation, "match") && <PackingStatus />}
              </section>
            )}

            {/* ── Step 3 — Improving your resume ──────────────────────────── */}
            {(screen === "improve" || screen === "bulk_apply") && !recruiterActive && (
              <section className="hc-agent-stage">
                <StageHeading
                  step="03"
                  name="Improving your resume"
                  title={improveDone ? "Raise your match, one change at a time." : "Closing the gaps your jobs found."}
                  lead={
                    improveDone
                      ? allDecided && !editing
                        ? "All changes decided. Opening your updated resume…"
                        : "Each change answers a gap your top jobs ask about, using only what your resume already shows. Apply them one by one, or all at once."
                      : "Your agent is turning each gap into a change, using only what your resume already shows."
                  }
                  pill={improveDone ? (allDecided ? "All decided" : "Ready for you") : "Agent is working"}
                />
                {editing && allDecided && (
                  <button type="button" className="hc-button hc-button--quiet hc-back-to-cv" onClick={() => setEditing(false)}>
                    See my updated resume →
                  </button>
                )}
                <div className="hc-split">
                  <div className="hc-split-main">
                    <ResumeReview
                      resume={resume}
                      recommendations={recommendations}
                      recommendationsAvailable={improveDone ? improve.recommendationsAvailable : true}
                      appliedIds={applied}
                      excludedItems={excluded}
                      locked={false}
                      gaps={gaps}
                      skippedIds={skipped}
                      hideApplyAll
                      onSkip={(id, on) => setSkipped((p) => (on ? [...p, id] : p.filter((x) => x !== id)))}
                      onToggleRecommendation={toggleApplied}
                      onToggleItem={(path) => setExcluded((p) => toggleExclusion(p, path))}
                    />
                  </div>
                  <ImprovePanel
                    jobs={runState.jobs}
                    assessments={runState.assessments}
                    topJobIds={topJobIds}
                    gaps={gaps}
                    recommendations={recommendations}
                    appliedIds={applied}
                    skippedIds={skipped}
                    onToggle={toggleApplied}
                    onApplyAll={() =>
                      setApplied((p) => [
                        ...p,
                        ...recs.filter((r) => !p.includes(r.id) && !skipped.includes(r.id)).map((r) => r.id),
                      ])
                    }
                  />
                </div>
              </section>
            )}

            {/* ── Step 4 — Your updated resume · Talk to a recruiter ─────── */}
            {recruiterActive && resume && (
              <section className="hc-agent-stage">
                <StageHeading
                  step="04"
                  name="Talk to a recruiter"
                  title="Your updated resume is ready."
                  lead="Book a quick call with a recruiter who hires in your field to go through it, and the gaps your agent could not close."
                  pill="Ready for you"
                />
                <div className="hc-split hc-split--stretch">
                  <div className="hc-split-main">
                    <CvPreview
                      resume={resume}
                      recommendations={recs}
                      appliedIds={applied}
                      excludedItems={excluded}
                      onEdit={() => setEditing(true)}
                    />
                  </div>
                  <RecruiterStep
                    recruiters={recruiters}
                    openGaps={openGaps}
                    onBook={() => setPaywallOpen(true)}
                    onDownload={() => setPaywallOpen(true)}
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

      {/* The paywall is the Flowkit checkout (screen 11), opened by Book or Download. */}
      <CheckoutOverlay
        open={paywallOpen}
        billing={runState.billing}
        launchProfile={publicConfig.launchProfile}
        selectedCount={topJobIds.length}
        includedPackages={publicConfig.maxSelectedPackages}
        reducedMotion={reducedMotion}
        stripeConfigured={Boolean(publicConfig.stripePublishableKey)}
        onClose={closePaywall}
        onStartSetup={() => {
          /* Card setup is wired in milestone 7; nothing is charged here. */
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
