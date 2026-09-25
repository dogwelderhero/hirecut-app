/** Types for `boards.mjs`. */
export interface Board {
  name: string;
  provider: "greenhouse" | "lever" | "ashby";
  careers_url: string;
  api?: string;
  enabled?: boolean;
}
export const CURATED_BOARDS: Board[];
export function enabledBoards(): Board[];
export function scopeDescription(boards?: Board[]): string;
