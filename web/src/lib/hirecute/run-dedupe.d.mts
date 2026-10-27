/** Types for `run-dedupe.mjs`. */
export function sourceHash(bytes: Uint8Array | string): string;
export function canReuseRun(
  prior: { sourceHash?: string; snapshot: { status: string; scenario?: { id: string } } } | null,
  next: { hash: string; scenarioId: string },
): boolean;
