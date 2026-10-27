import { improveScreen } from "./recruiter/improve";
import { jobsGapsScreen } from "./recruiter/jobs-gaps";
import { resumeReadScreen } from "./recruiter/resume-read";
import type { ScreenModule } from "./types";

/**
 * The React half of the workspace screen registry: screen id → module. The
 * ids a flow may name are SCREEN_IDS in lib/hirecute/flow.mjs; a test keeps
 * the two in step. A screen missing here renders nothing rather than crashing
 * the shell (the vacancy screens arrive in the next step).
 */
export const SCREENS: Partial<Record<string, ScreenModule>> = {
  "resume-read": resumeReadScreen,
  "jobs-gaps": jobsGapsScreen,
  improve: improveScreen,
};
