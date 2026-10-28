"use client";

import { refineReceipt } from "@/lib/hirecute/actions";
import { isDwelling, isPacking } from "@/lib/hirecute/presentation";
import type { RunState } from "@/lib/hirecute/run-store";
import { PackingStatus, StageHeading } from "../common";
import type { ScreenModule, ScreenProps } from "../types";
import { stageActions } from "./shared";
import { DocScanVisual, WorkingPanel } from "./working-panel";

/** The classic refine result (its list of changes), or null while working. */
function classicRefine(runState: RunState) {
  const refine = runState.stages.refine?.result;
  return refine?.kind === "refine" && "changes" in refine ? refine : null;
}

/** Screen 03 — Finetune Resume. */
function RefineChanges({ runState, presentation, fileName }: ScreenProps) {
  const refine = classicRefine(runState);
  return (
    <section className="hc-agent-stage">
      {!refine ? (
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
            actions={stageActions(runState, "refine")}
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
            Real counts. §4: "do not hardcode '8 improvements,' '3 bullet points
            clarified' or '0 facts invented'." The reference's third metric
            claims zero invented facts as a guarantee; the fact checker is a
            heuristic, so it is replaced with what we can actually stand behind.
          */}
          <div className="hc-grid3 hc-space-bottom">
            <div className="hc-metric">
              <strong>{refine.changes.length}</strong>
              <span>Improvements made</span>
            </div>
            <div className="hc-metric">
              <strong>{refine.changes.filter((c) => c.kind === "clarity").length}</strong>
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
  );
}

export const refineChangesScreen: ScreenModule = {
  Screen: RefineChanges,
  receipts: {
    refine: ({ runState, presentation }) => {
      const refine = classicRefine(runState);
      if (!refine || isDwelling(presentation, "refine")) return null;
      return {
        stage: "refine",
        label: "Resume refined",
        detail: refineReceipt(refine.changes.length).replace(/^Resume (refined|reviewed) · /, ""),
      };
    },
  },
};
