/**
 * A scenario's journey inside the workspace: which stages it runs, how they
 * group into the steps the visitor sees, which screen shows each stage, and the
 * presentation rules (which results dwell and pack, which have no screen).
 *
 * Lives in web/scenarios/<id>.json under "flow". Everything that used to be a
 * global table (STAGE_ORDER, STAGE_TO_SCREEN, PACKING_STAGES, ABSORBED_STAGES,
 * the stepper's and transcript's step lists) is per scenario here, so two
 * journeys share one shell without `if (scenario === …)` in the code.
 *
 * Pure: the server validates it (preflight), the browser reads it.
 */

/** Screen ids the workspace registry knows (components/hirecute/workspace/screens.tsx). */
export const SCREEN_IDS = ["resume-read", "jobs-gaps", "improve", "refine-changes", "explore", "matches", "bulk-apply"];

const SLOTS = ["refine", "explore", "match", "improve", "prepare"];

/** 1-based visible step number of a stage, or null if no step lists it. */
export function stepNumberOf(flow, stage) {
  const i = flow.steps.findIndex((s) => s.stages.includes(stage));
  return i < 0 ? null : i + 1;
}

/** The screen that shows a stage; the first stage's screen when nothing is visible yet. */
export function screenOf(flow, stage) {
  return (stage && flow.screens[stage]) || flow.screens[flow.stages[0]];
}

/** The stage after `stage` in this journey, or null at the end. */
export function nextStageOf(flow, stage) {
  const i = flow.stages.indexOf(stage);
  return i < 0 ? null : (flow.stages[i + 1] ?? null);
}

/**
 * @param {string} id
 * @param {object} flow
 * @param {string[]} pipelineStages  stage slots the scenario's steps report into
 * @returns {string[]} errors
 */
export function validateFlow(id, flow, pipelineStages) {
  const errors = [];
  const err = (m) => errors.push(`${id} flow: ${m}`);
  if (!flow || typeof flow !== "object") return [`${id} flow: missing`];

  const stages = Array.isArray(flow.stages) ? flow.stages : [];
  for (const s of stages) if (!SLOTS.includes(s)) err(`unknown stage "${s}"`);
  const want = [...new Set(pipelineStages)].sort().join(",");
  if ([...stages].sort().join(",") !== want) {
    err(`stages [${stages.join(", ")}] must be exactly the stages the pipeline reports into [${want}]`);
  }

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (!steps.length) err("no steps");
  const seen = new Map();
  for (const [i, step] of steps.entries()) {
    if (typeof step?.title !== "string" || !step.title) err(`step ${i + 1} has no title`);
    if (!Array.isArray(step?.stages)) {
      err(`step ${i + 1} has no stages list`);
      continue;
    }
    if (!step.stages.length && !step.local) err(`step ${i + 1} has no stages; mark it "local": true if it runs in the browser`);
    for (const s of step.stages) {
      if (!stages.includes(s)) err(`step ${i + 1} lists "${s}", which is not one of the flow's stages`);
      if (seen.has(s)) err(`stage "${s}" is in steps ${seen.get(s)} and ${i + 1}`);
      seen.set(s, i + 1);
    }
  }
  for (const s of stages) if (!seen.has(s)) err(`stage "${s}" is in no step`);

  for (const s of stages) {
    const screen = flow.screens?.[s];
    if (!screen) err(`stage "${s}" has no screen`);
    else if (!SCREEN_IDS.includes(screen)) err(`stage "${s}" uses unknown screen "${screen}"`);
  }
  for (const k of ["packing", "absorbed"]) {
    for (const s of flow[k] ?? []) if (!stages.includes(s)) err(`${k} lists "${s}", which is not one of the flow's stages`);
  }
  return errors;
}
