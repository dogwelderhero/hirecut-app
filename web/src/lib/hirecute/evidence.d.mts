/** Types for `evidence.mjs`. */
import type { MatchAssessment, MatchEvidence, Job, JobId } from "./contracts";

export const MIN_QUOTE_CHARS: number;
export const MAX_QUOTE_CHARS: number;
export function normalizeForMatch(text: unknown): string;
export function verifyQuote(quote: unknown, source: string): string | null;
export function checkRequirement(
  raw: unknown,
  sources: { jobText: string; resumeText: string },
): MatchEvidence | null;

export interface GapJobRef {
  jobId: JobId;
  title: string;
  company: string;
  jobQuote: string;
  resumeQuote: string | null;
}
export interface ResumeGap {
  id: string;
  requirement: string;
  importance: "must_have" | "nice_to_have";
  match: "partial" | "missing";
  jobs: GapJobRef[];
}
export function collectGaps(
  assessments: MatchAssessment[],
  jobs: Record<JobId, Job> | Job[],
): ResumeGap[];
