/**
 * Typed view of the Milestone 1 fixtures.
 *
 * The values live in `fixture-data.mjs` so the journey worker can import them
 * without type stripping; this module only applies types. Constraints from the
 * brief, all satisfied by the data itself:
 *
 *  1. "A fixture mode may be explicitly marked as local/demo; never silently
 *     fall back to mock results when a real provider or model fails." Hence
 *     `FIXTURE_ORIGIN = "sample"` — a fixture run is always identifiable and
 *     excluded from live conversion analytics.
 *  2. "Do not persist the prototype's illustrative jobs as live seed results."
 *     Nothing here is written to a run store; it is produced on demand for an
 *     explicitly-marked sample journey.
 *  3. "Do not hardcode the demonstrated Alex Morgan profile." That candidate,
 *     its 146 jobs, its 98% scores and its masked `.example` recruiter
 *     addresses are all absent. The companies are real public ATS tenants, the
 *     scores are unremarkable, and every unknown field is genuinely unknown.
 */

import type {
  ApplicationPackage,
  Job,
  MatchAssessment,
  RefinementChange,
  RunOrigin,
  SearchCoverage,
} from "./contracts";
import * as data from "@/lib/hirecute/fixture-data.mjs";

export const FIXTURE_RUN_ID: string = data.FIXTURE_RUN_ID;
export const FIXTURE_ORIGIN: RunOrigin = data.FIXTURE_ORIGIN;
export const FIXTURE_JOBS: Job[] = data.FIXTURE_JOBS;
export const FIXTURE_COVERAGE: SearchCoverage = data.FIXTURE_COVERAGE;
export const FIXTURE_ASSESSMENTS: MatchAssessment[] = data.FIXTURE_ASSESSMENTS;
export const FIXTURE_REFINEMENT_CHANGES: RefinementChange[] = data.FIXTURE_REFINEMENT_CHANGES;

export const fixtureApplications: () => ApplicationPackage[] = data.fixtureApplications;
export const fixtureLetterText: (company: string, title: string) => string =
  data.fixtureLetterText;
