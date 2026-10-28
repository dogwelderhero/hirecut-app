/**
 * Explore for the vacancy journey, v2: the frozen production search
 * (legacy/v1, 01083211) unchanged, plus public progress per board.
 *
 * v1 already reports every board that really finishes, but only to private
 * diagnostics. This wrapper passes each of those completions on as an
 * `explore.boards` event, so the search screen can count real boards instead
 * of showing a still ring. The search, its results and its writes are v1's.
 */

import { enabledBoards } from "../../src/lib/hirecute/boards.mjs";
import { runExploreStage as runFrozenExplore } from "../legacy/v1/stages/explore.mjs";

/**
 * Wrap a search stage so its per-board diagnostics also become public progress.
 * @param {(ctx: object) => Promise<object>} runSearch
 * @param {Array<{name: string, provider: string}>} boards  the list the search walks
 */
export function withBoardProgress(runSearch, boards) {
  return async (ctx) => {
    const providerOf = new Map(boards.map((b) => [b.name, b.provider]));
    const providers = {};
    for (const b of boards) {
      providers[b.provider] ??= { done: 0, total: 0 };
      providers[b.provider].total += 1;
    }
    let boardsDone = 0;
    const report = () =>
      ctx.emit("explore.boards", { boardsDone, boardsTotal: boards.length, providers: structuredClone(providers) }, "explore");

    const diag = (entry) => {
      ctx.diag(entry);
      // v1's per-board completion, real or failed: either way that board is checked.
      const board = entry?.board?.board;
      if (typeof board !== "string") return;
      boardsDone += 1;
      const provider = providerOf.get(board);
      if (provider) providers[provider].done += 1;
      report();
    };

    report();
    return runSearch({ ...ctx, diag });
  };
}

// The same board list v1 searches, so the count can reach its total.
export const runExploreStage = withBoardProgress(runFrozenExplore, enabledBoards());
