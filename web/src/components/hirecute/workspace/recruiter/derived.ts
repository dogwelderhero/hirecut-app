import type { ResumeGap } from "@/lib/hirecute/contracts";
import { collectGaps } from "@/lib/hirecute/evidence.mjs";
import type { RunState } from "@/lib/hirecute/run-store";
import { pickRecruiters } from "../../recruiters";

/**
 * Values the recruiter journey derives from the run, shared by its screens and
 * their transcript receipts so both always agree.
 */

/** The parsed resume: the refine result once it lands, the streamed parse before. */
export function resumeOf(runState: RunState) {
  const refine = runState.stages.refine?.result;
  return refine?.kind === "refine" && "resume" in refine ? refine.resume : runState.parsedResume;
}

export function improveResultOf(runState: RunState) {
  const improve = runState.stages.improve?.result;
  return improve?.kind === "improve" ? improve : null;
}

/** Gaps: the improve stage's, or collected live from the assessments before it. */
export function gapsOf(runState: RunState): ResumeGap[] {
  const improve = improveResultOf(runState);
  return improve ? improve.gaps : collectGaps(Object.values(runState.assessments), runState.jobs);
}

/** Gaps no recommendation answers — what the recruiter step is for. */
export function openGapsOf(runState: RunState): ResumeGap[] {
  const recommendations = improveResultOf(runState)?.recommendations ?? [];
  const answered = new Set(recommendations.flatMap((r) => r.gapIds ?? []));
  return gapsOf(runState).filter((g) => !answered.has(g.id));
}

/** The three best jobs: the match ranking, else the scores. */
export function topJobIdsOf(runState: RunState): string[] {
  const match = runState.stages.match?.result;
  const ranked = match?.kind === "match" ? match.rankedJobIds : [];
  const ids = ranked.length
    ? ranked
    : Object.keys(runState.assessments).sort(
        (a, b) => runState.assessments[b].score5 - runState.assessments[a].score5,
      );
  return ids.filter((id) => runState.jobs[id]).slice(0, 3);
}

/** Recruiters whose industry fits the resume and the jobs found. */
export function recruitersFor(runState: RunState) {
  const resume = resumeOf(runState);
  const titles = Object.values(runState.jobs).map((j) => j.title);
  const text = [resume?.targetTitle, resume?.summary, ...(resume?.experience ?? []).map((e) => e.role), ...titles]
    .filter(Boolean)
    .join(" ");
  return pickRecruiters(text, 3);
}
