/**
 * The scripted stage timeline for the fixture journey — plain ESM.
 *
 * `.mjs` because the journey WORKER imports it. It emits the SAME public
 * envelopes a real worker will emit, so the parent's event pipeline, the run
 * store and the screens are exercised against the real protocol rather than a
 * shortcut. Milestones 3-6 replace these stage bodies with real work.
 *
 * The timings here are the WORKER's pace, not the presentation clock: the 2s
 * dwell and 780ms pack are applied independently by presentation.ts, which is
 * exactly the separation the guide requires.
 */

import { ACTION_LABELS, rankingActionLabel } from "./action-labels.mjs";
import {
  FIXTURE_ASSESSMENTS,
  FIXTURE_COVERAGE,
  FIXTURE_JOBS,
  FIXTURE_REFINEMENT_CHANGES,
  fixtureApplications,
  fixtureLetterText,
} from "./fixture-data.mjs";


const RUN_ID = "sample-run";

function envelope(seq, type, payload) {
  return {
    version: 1,
    runId: RUN_ID,
    seq,
    time: new Date().toISOString(),
    input: {
      journeyVersion: 1,
      sourceResumeHash: "sha256:fixture-resume",
      preferencesVersion: 1,
      stageInputVersion: 1,
      stageAttempt: 1,
    },
    type,
    payload,
  };
}

function action(stage, index, label) {
  return {
    id: `${stage}-${index}`,
    stage,
    label,
    status: "in_progress",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
}

/**
 * Build the whole scripted timeline up front. A caller schedules each entry;
 * the store's `seq` guard means a double-delivered entry is harmless.
 */
export function fixtureTimeline() {
  const out = [];
  let seq = 0;
  let t = 0;
  const push = (at, type, payload) => {
    seq += 1;
    out.push({ at, event: envelope(seq, type, payload) });
  };

  push((t += 0), "run.queued", { queuePosition: 1 });
  push((t += 400), "run.started", { stage: "refine" });

  /** Reveal one action at a time: start, wait, complete, then the next starts. */
  function runActions(stage, labels, each = 550) {
    labels.forEach((label, i) => {
      push((t += each), "action.started", { action: action(stage, i, label) });
      push((t += each), "action.completed", { stage, actionId: `${stage}-${i}` });
    });
  }

  // ── Stage 1: refine ──────────────────────────────────────────────────
  push((t += 100), "stage.started", { stage: "refine", inputVersion: 1, attempt: 1 });
  runActions("refine", ACTION_LABELS.refine);
  push((t += 200), "stage.result", {
    stage: "refine",
    inputVersion: 1,
    result: {
      kind: "refine",
      originalArtifactId: "art-original",
      refinedResumeArtifactId: "art-refined",
      changes: FIXTURE_REFINEMENT_CHANGES,
      originalPreserved: true,
    },
  });

  // ── Stage 2: explore ─────────────────────────────────────────────────
  push((t += 300), "stage.started", { stage: "explore", inputVersion: 1, attempt: 1 });
  runActions("explore", ACTION_LABELS.explore);
  // Jobs arrive individually, as a real provider sweep delivers them.
  FIXTURE_JOBS.forEach((job) => push((t += 120), "job.discovered", { job }));
  push((t += 200), "stage.result", {
    stage: "explore",
    inputVersion: 1,
    result: {
      kind: "explore",
      jobIds: FIXTURE_JOBS.map((j) => j.id),
      coverage: FIXTURE_COVERAGE,
    },
  });

  // ── Stage 3: match ───────────────────────────────────────────────────
  push((t += 300), "stage.started", { stage: "match", inputVersion: 1, attempt: 1 });
  const matchLabels = [
    ...ACTION_LABELS.match.slice(0, 3),
    // The real shortlist count, not a placeholder.
    rankingActionLabel(FIXTURE_ASSESSMENTS.length),
  ];
  runActions("match", matchLabels);
  // Evaluations complete incrementally; cards gain score panels as they land.
  FIXTURE_ASSESSMENTS.forEach((assessment) =>
    push((t += 150), "job.evaluated", { assessment }),
  );
  const ranked = [...FIXTURE_ASSESSMENTS]
    .sort((a, b) => b.score5 - a.score5)
    .map((a) => a.jobId);
  push((t += 200), "stage.result", {
    stage: "match",
    inputVersion: 1,
    result: { kind: "match", assessments: FIXTURE_ASSESSMENTS, rankedJobIds: ranked },
  });

  // ── Stage 4: prepare ─────────────────────────────────────────────────
  push((t += 300), "stage.started", { stage: "prepare", inputVersion: 1, attempt: 1 });
  const applications = fixtureApplications();
  // Everything scored starts selected; the visitor narrows it down.
  push((t += 100), "selection.updated", {
    selection: {
      jobIds: applications.map((a) => a.jobId),
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  });
  runActions("prepare", ACTION_LABELS.prepare, 500);

  applications.forEach((app) => {
    // A package appears as preparing first, so readiness is observed changing
    // from real state rather than from an elapsed timer.
    push((t += 150), "application.updated", {
      application: { ...app, readiness: { status: "preparing" } },
    });
    push((t += 100), "letter.started", {
      jobId: app.jobId,
      generationId: `gen-${app.jobId}`,
      baseVersion: null,
    });

    // Stream the letter in a few chunks, as the model will.
    const job = FIXTURE_JOBS.find((j) => j.id === app.jobId);
    const text = fixtureLetterText(job.company, job.title);
    const chunks = text.match(/[\s\S]{1,90}/g) ?? [text];
    chunks.forEach((chunk) =>
      push((t += 90), "letter.delta", {
        jobId: app.jobId,
        generationId: `gen-${app.jobId}`,
        baseVersion: null,
        text: chunk,
      }),
    );

    push((t += 120), "letter.completed", {
      jobId: app.jobId,
      generationId: `gen-${app.jobId}`,
      revision: app.letter.current,
    });
    // Readiness flips only now, on the real package state.
    push((t += 60), "application.updated", { application: app });
  });

  const prepared = applications.filter((a) => a.readiness.status === "ready");
  const blocked = applications.filter((a) => a.readiness.status === "needs_input");
  push((t += 200), "stage.result", {
    stage: "prepare",
    inputVersion: 1,
    result: {
      kind: "prepare",
      preparedJobIds: prepared.map((a) => a.jobId),
      blockedJobIds: blocked.map((a) => a.jobId),
      failedJobIds: [],
    },
  });

  // Billing starts at requires_card. It is never inferred from a CTA click.
  push((t += 100), "billing.updated", {
    billing: {
      status: "requires_card",
      mode: "test",
      promotionalCredit: null,
      entitlement: null,
      amountChargedMinor: 0,
      error: null,
    },
  });

  // Preparation finished. Bulk Apply stays mounted.
  push((t += 100), "run.done", { outcome: "preparation_complete", resultStage: "prepare" });

  return out;
}
