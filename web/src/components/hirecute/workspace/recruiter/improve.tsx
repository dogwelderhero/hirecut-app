"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toggleExclusion } from "@/lib/hirecute/resume.mjs";
import { CheckoutOverlay } from "../../checkout-overlay";
import { CvPreview } from "../../cv-preview";
import { ImprovePanel } from "../../improve-panel";
import { RecruiterStep } from "../../recruiter-step";
import { ResumeReview } from "../../resume-review";
import { StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { gapsOf, improveResultOf, openGapsOf, recruitersFor, resumeOf, topJobIdsOf } from "./derived";

/**
 * Steps 3 and 4 share this screen.
 *
 *   3. Improving your resume — changes built from the gaps, with evidence. The
 *      first place the visitor acts; it never packs away.
 *   4. Talk to a recruiter — once every change is applied or skipped, the
 *      updated resume and the recruiters open. Book / Download → paywall.
 *
 * Step 4 has no backend stage: it reports itself to the shell as the flow's
 * local step, and its paywall portals next to the shell so the shell can go
 * inert behind it.
 */
function Improve({ runState, publicConfig, reducedMotion, shell }: ScreenProps) {
  const [applied, setApplied] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  /** The visitor went back from the preview to change their choices. */
  const [editing, setEditing] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const resume = resumeOf(runState);
  const improve = improveResultOf(runState);
  const improveDone = improve !== null;
  const gaps = gapsOf(runState);
  const recommendations = improve ? improve.recommendations : null;
  const recs = recommendations ?? [];
  const openGaps = openGapsOf(runState);
  const toggleApplied = (id: string) => {
    setSkipped((p) => p.filter((x) => x !== id));
    setApplied((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  // Step 3 → 4: once every change is applied (or skipped), the updated resume
  // and the recruiters open. A short beat lets the last "applied" register.
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
  const recruiterActive = cvReady;

  const topJobIds = useMemo(() => topJobIdsOf(runState), [runState]);
  const recruiters = useMemo(() => recruitersFor(runState), [runState]);

  // Layout effects, so the transcript, stepper and inert shell change in the
  // same paint as this screen.
  const { setLocalStep, setInert } = shell;
  useLayoutEffect(() => {
    setLocalStep(
      recruiterActive
        ? {
            done: true,
            actions: [
              { id: "rs-0", label: "Matching you with recruiters who hire in your field", status: "completed" },
              { id: "rs-1", label: `${recruiters.length} recruiters ready for a quick call`, status: "completed" },
            ],
          }
        : null,
    );
  }, [recruiterActive, recruiters.length, setLocalStep]);
  useLayoutEffect(() => {
    setInert(paywallOpen);
  }, [paywallOpen, setInert]);
  useLayoutEffect(
    () => () => {
      setLocalStep(null);
      setInert(false);
    },
    [setLocalStep, setInert],
  );

  return (
    <>
      {!recruiterActive && (
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
                recommendationsAvailable={improve ? improve.recommendationsAvailable : true}
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

      {/* The paywall is the Flowkit checkout (screen 11), opened by Book or Download. */}
      {shell.overlayRoot &&
        createPortal(
          <CheckoutOverlay
            open={paywallOpen}
            billing={runState.billing}
            launchProfile={publicConfig.launchProfile}
            selectedCount={topJobIds.length}
            includedPackages={publicConfig.maxSelectedPackages}
            reducedMotion={reducedMotion}
            stripeConfigured={Boolean(publicConfig.stripePublishableKey)}
            onClose={() => setPaywallOpen(false)}
            onStartSetup={() => {
              /* Card setup is wired in milestone 7; nothing is charged here. */
            }}
          />,
          shell.overlayRoot,
        )}
    </>
  );
}

export const improveScreen: ScreenModule = {
  Screen: Improve,
  receipts: {
    improve: ({ runState }) => {
      const improve = improveResultOf(runState);
      if (!improve) return null;
      const openGaps = openGapsOf(runState);
      return {
        stage: "improve",
        label: `${improve.recommendations.length} change${improve.recommendations.length === 1 ? "" : "s"} suggested`,
        detail: `${openGaps.length} gap${openGaps.length === 1 ? "" : "s"} to discuss with a recruiter`,
      };
    },
  },
};
