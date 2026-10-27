import { improveScreen } from "./recruiter/improve";
import { jobsGapsScreen } from "./recruiter/jobs-gaps";
import { resumeReadScreen } from "./recruiter/resume-read";
import type { ScreenModule } from "./types";
import { bulkApplyScreen } from "./vacancy/bulk-apply";
import { exploreScreen } from "./vacancy/explore";
import { matchesScreen } from "./vacancy/matches";
import { refineChangesScreen } from "./vacancy/refine-changes";

/**
 * The React half of the workspace screen registry: screen id → module. The
 * ids a flow may name are SCREEN_IDS in lib/hirecute/flow.mjs; a test keeps
 * the two in step. A screen missing here renders nothing rather than crashing
 * the shell.
 */
export const SCREENS: Partial<Record<string, ScreenModule>> = {
  // recruiter (product-v2)
  "resume-read": resumeReadScreen,
  "jobs-gaps": jobsGapsScreen,
  improve: improveScreen,
  // vacancy (production 01083211)
  "refine-changes": refineChangesScreen,
  explore: exploreScreen,
  matches: matchesScreen,
  "bulk-apply": bulkApplyScreen,
};
