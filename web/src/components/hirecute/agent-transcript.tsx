"use client";

/**
 * The left conversation column — `aside.hc-sidebar.hc-conversation`.
 *
 * Ported from the reference screens' shared shell (visible in 03/05/07/09).
 * Structure and classes are theirs: `hc-chat-received`, `hc-chat-stage`,
 * `hc-chat-status`, `ol.hc-chat-actions > li.hc-chat-action`, the
 * `details.hc-chat-history` collapse once a stage completes,
 * `button.hc-chat-result` receipts, `hc-chat-next`, `hc-chat-footer`.
 *
 * It is a work transcript, not a candidate card: §2 is explicit that the
 * removed "Alex Morgan / Product Designer" and "Private by default" panels do
 * not come back.
 *
 * Actions render only once they have STARTED — the future list is never
 * printed up front — and their marks follow real status rather than a script.
 */

import type { ActionProgress, StageId } from "@/lib/hirecute/contracts";

export interface StageReceipt {
  stage: StageId;
  /** Real copy from real counts — see lib/hirecute/actions.ts. */
  label: string;
  detail?: string;
  /** Opens the persisted result read-only. Absent until the artifact exists. */
  onOpen?: () => void;
}

const STAGE_TITLES: Record<StageId, string> = {
  refine: "Reading your resume",
  explore: "Finding jobs",
  match: "Finding jobs & gaps",
  improve: "Improving your resume",
  prepare: "Bulk Apply",
};

/** Visible step per stage: finding and scoring jobs are one step (2). */
const STAGE_NUMBER: Record<StageId, number> = { refine: 1, explore: 2, match: 2, improve: 3, prepare: 4 };
const STEP_COUNT = 4;

/** One visible step can span stages (finding + scoring jobs is step 2). */
const STEP_TITLES: Record<number, string> = {
  1: "Reading your resume",
  2: "Finding jobs & gaps",
  3: "Improving your resume",
  4: "Talk to a recruiter",
};

/** Step 4 runs in the browser (no backend work), so its rows are passed in. */
export interface LocalStep {
  actions: Array<{ id: string; label: string; status: ActionProgress["status"] }>;
  done: boolean;
}

/** The reference uses ›/·/✓ rather than icons. */
function mark(status: ActionProgress["status"]): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "!";
  return "›";
}

export function AgentTranscript({
  fileName,
  actions,
  receipts,
  queued,
  liveStage,
  nextStage,
  recruiterStep,
}: {
  fileName: string | null;
  actions: ActionProgress[];
  receipts: StageReceipt[];
  queued: boolean;
  liveStage: StageId | null;
  nextStage: StageId | null;
  recruiterStep?: LocalStep | null;
}) {
  /** Completed stages collapse into a history disclosure, as in the reference. */
  const completedStages = receipts.map((r) => r.stage);
  const liveStep = liveStage ? STAGE_NUMBER[liveStage] : null;
  // Every action of the live STEP that no receipt has absorbed yet: finding
  // jobs stays listed while scoring runs, because both are step 2.
  const liveActions = actions.filter(
    (a) => STAGE_NUMBER[a.stage] === liveStep && !completedStages.includes(a.stage),
  );

  return (
    <aside className="hc-sidebar hc-conversation" aria-label="Agent activity">
      <a className="hc-brand" href="/" aria-label="hirecute home">
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
          <path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z" />
        </svg>
        <span>hirecute</span>
      </a>

      <div className="hc-chat-transcript">
        {fileName && (
          <div className="hc-chat-received">
            <span aria-hidden>✓</span>
            {/* The actual file name, never a placeholder. */}
            <span>{fileName} received. Let’s get to work.</span>
          </div>
        )}

        {/* Completed stages, each with its saved-result receipt. */}
        {receipts.map((receipt) => {
          const stageActions = actions.filter((a) => STAGE_NUMBER[a.stage] === STAGE_NUMBER[receipt.stage]);
          return (
            <section className="hc-chat-stage" key={receipt.stage}>
              <h3>
                ✓ Step {STAGE_NUMBER[receipt.stage]} · {STEP_TITLES[STAGE_NUMBER[receipt.stage]]}
              </h3>
              <details className="hc-chat-history">
                <summary>
                  <span>
                    {stageActions.length} action{stageActions.length === 1 ? "" : "s"} completed
                  </span>
                </summary>
                <ol className="hc-chat-actions">
                  {stageActions.map((a) => (
                    <li className="hc-chat-action" key={a.id}>
                      <span className="hc-chat-mark">{mark(a.status)}</span>
                      <span className="hc-chat-action-text">{a.label}</span>
                    </li>
                  ))}
                </ol>
              </details>
              {/*
                A receipt opens the PERSISTED result read-only. It never
                restarts work or changes the live stage, and it is disabled
                until the artifact exists.
              */}
              <button
                type="button"
                className="hc-chat-result"
                onClick={receipt.onOpen}
                disabled={!receipt.onOpen}
                data-hc-zone="chat_receipt"
              >
                {/*
                  The label and detail share ONE span in the reference; as
                  siblings of the ↗ they became three flex columns and the
                  title wrapped mid-phrase.
                */}
                <span>
                  <strong>{receipt.label}</strong>
                  {receipt.detail && <small>{receipt.detail}</small>}
                </span>
                <span aria-hidden>↗</span>
              </button>
            </section>
          );
        })}

        {/* The live stage: one status line and the actions started so far. */}
        {liveStage && !completedStages.includes(liveStage) && (
          <section className="hc-chat-stage">
            <h3>{liveStep ? STEP_TITLES[liveStep] : STAGE_TITLES[liveStage]}</h3>
            <div className="hc-chat-status">
              {/* A genuinely queued worker says queued — it does not invent an action. */}
              {queued
                ? "your agent is queued"
                : `hirecute agent is working on step ${STAGE_NUMBER[liveStage]} of ${STEP_COUNT}`}
            </div>
            {!queued && (
              <ol className="hc-chat-actions">
                {liveActions.map((a) => (
                  <li className="hc-chat-action" key={a.id}>
                    <span className="hc-chat-mark">{mark(a.status)}</span>
                    <span className="hc-chat-action-text">
                      {a.label}
                      {a.status === "in_progress" ? "…" : ""}
                      {a.status === "failed" && a.error && (
                        <small className="hc-danger"> {a.error.message}</small>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {recruiterStep && (
          <section className="hc-chat-stage">
            <h3>{recruiterStep.done ? "✓ Step 4 · " : ""}{STEP_TITLES[4]}</h3>
            {!recruiterStep.done && (
              <div className="hc-chat-status">hirecute agent is working on step 4 of {STEP_COUNT}</div>
            )}
            <ol className="hc-chat-actions">
              {recruiterStep.actions.map((a) => (
                <li className="hc-chat-action" key={a.id}>
                  <span className="hc-chat-mark">{mark(a.status)}</span>
                  <span className="hc-chat-action-text">
                    {a.label}
                    {a.status === "in_progress" ? "…" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        {nextStage && !recruiterStep && (
          <div className="hc-chat-next">
            <span>Up next: </span>
            <strong>{STEP_TITLES[STAGE_NUMBER[nextStage]] ?? STAGE_TITLES[nextStage]}</strong>
          </div>
        )}
      </div>

      <div className="hc-chat-footer">
        <p>Results stay here as your agent moves forward.</p>
      </div>
    </aside>
  );
}
