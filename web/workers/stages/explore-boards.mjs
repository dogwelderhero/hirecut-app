/**
 * Explore for the recruiter journey, v2: explore@1 unchanged, plus public
 * progress per board.
 *
 * The recruiter's step 2 now opens on the search screen with the ring (the
 * vacancy journey's), so it needs the same `explore.boards` events. explore@1
 * already reports every finished board to private diagnostics in the shape
 * `withBoardProgress` reads; the search, its results and its writes are v1's.
 */

import { enabledBoards } from "../../src/lib/hirecute/boards.mjs";
import { runExploreStage as runSearch } from "./explore.mjs";
import { withBoardProgress } from "./explore-classic.mjs";

// The same board list explore@1 searches, so the count can reach its total.
export const runExploreStage = withBoardProgress(runSearch, enabledBoards());
