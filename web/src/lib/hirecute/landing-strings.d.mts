/** Types for `landing-strings.mjs`. */
import type { LaunchProfile } from "./contracts";

export const LAUNCH_PROFILES: readonly LaunchProfile[];
export function isVariant(value: unknown): boolean;
export function resolveVariants<T>(value: T, launchProfile: LaunchProfile): T;
export function mergeStrings(
  common: Record<string, unknown>,
  scenario: Record<string, unknown>,
): Record<string, unknown>;
export function format(template: string, params?: Record<string, string | number>): string;
