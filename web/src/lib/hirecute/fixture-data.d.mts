/**
 * Types for `fixture-data.mjs`.
 *
 * The data is plain ESM so the journey worker can import it without type
 * stripping; this declaration is how the TypeScript side still checks it
 * against the real contracts. If a fixture drifts from `contracts.ts`, the
 * error surfaces here rather than at a call site.
 */

import type {
  ApplicationPackage,
  Job,
  MatchAssessment,
  RefinementChange,
  RunOrigin,
  SearchCoverage,
} from "./contracts";

export const FIXTURE_RUN_ID: string;
export const FIXTURE_ORIGIN: RunOrigin;
export const FIXTURE_JOBS: Job[];
export const FIXTURE_COVERAGE: SearchCoverage;
export const FIXTURE_ASSESSMENTS: MatchAssessment[];
export const FIXTURE_REFINEMENT_CHANGES: RefinementChange[];
export function fixtureApplications(): ApplicationPackage[];
export function fixtureLetterText(company: string, title: string): string;
