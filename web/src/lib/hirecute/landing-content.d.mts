/** Types for `landing-content.mjs`. */
import type { LaunchProfile } from "./contracts";

export { LAUNCH_PROFILES, format, mergeStrings, resolveVariants } from "./landing-strings.mjs";
export const SHELL_KEYS: readonly string[];

export interface BlockSpec {
  anchor?: string;
  keys: readonly string[];
  options?: Record<string, { keys: readonly string[] }>;
}
export const BLOCKS: Record<string, BlockSpec>;

/** One entry of a scenario's `landing.blocks`, with its default anchor filled in. */
export interface LandingBlock {
  block: string;
  anchor?: string;
  [option: string]: unknown;
}

/** Strings after variant resolution: values are text, lists, or lists of objects. */
export type LandingStrings = Record<string, unknown>;

export interface LandingContent {
  scenario: string;
  blocks: LandingBlock[];
  strings: LandingStrings;
}

export function contentDir(codeRoot: string): string;
export function loadLandingContent(
  codeRoot: string,
  scenarioId: string,
  opts: { launchProfile: LaunchProfile },
): Promise<LandingContent>;
export function requiredKeys(blocks: LandingBlock[]): string[];
export function validateLanding(
  scenarioId: string,
  blocks: LandingBlock[],
  strings: LandingStrings,
): { errors: string[]; warnings: string[] };
export function checkLanding(codeRoot: string, scenarioId: string): Promise<{ errors: string[]; warnings: string[] }>;
