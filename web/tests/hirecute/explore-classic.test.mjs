import { test } from "node:test";
import assert from "node:assert/strict";
import { withBoardProgress } from "../../workers/stages/explore-classic.mjs";

const BOARDS = [
  { name: "Monzo", provider: "greenhouse" },
  { name: "Wise", provider: "greenhouse" },
  { name: "Linear", provider: "ashby" },
];

test("explore-classic@2 publishes each board v1 finishes, and keeps v1's diagnostics and result", async () => {
  const emitted = [];
  const diags = [];
  const fakeSearch = async (ctx) => {
    ctx.diag({ search: { targetRoles: ["x"] } });
    ctx.diag({ board: { board: "Wise", ok: true, count: 4 } });
    ctx.diag({ board: { board: "Linear", ok: false, reason: "timeout" } });
    return { ok: true, jobs: ["j1"] };
  };
  const run = withBoardProgress(fakeSearch, BOARDS);
  const out = await run({ emit: (type, payload) => emitted.push({ type, payload }), diag: (e) => diags.push(e) });

  assert.deepEqual(out, { ok: true, jobs: ["j1"] }, "the search's own result passes through untouched");
  assert.equal(diags.length, 3, "every diagnostic still reaches the private log");
  assert.deepEqual(
    emitted.map((e) => [e.type, e.payload.boardsDone, e.payload.boardsTotal]),
    [["explore.boards", 0, 3], ["explore.boards", 1, 3], ["explore.boards", 2, 3]],
  );
  assert.deepEqual(emitted.at(-1).payload.providers, { greenhouse: { done: 1, total: 2 }, ashby: { done: 1, total: 1 } });
});

test("explore@2 is explore@1 plus board progress: same reads and writes", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = async (id) => JSON.parse(await readFile(new URL(`../../workers/steps/${id}.json`, import.meta.url), "utf8"));
  const [v1, v2] = await Promise.all([manifest("explore@1"), manifest("explore@2")]);
  assert.deepEqual([v2.stage, v2.reads, v2.writes, v2.defaults], [v1.stage, v1.reads, v1.writes, v1.defaults]);
  const mod = await import("../../workers/stages/explore-boards.mjs");
  assert.equal(typeof mod.runExploreStage, "function");
});
