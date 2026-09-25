import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * hirecute serves Inter, matching the finished designs in the MVP screens pack.
 *
 * The invariant these tests protect has never changed and is the reason they
 * exist: a build must never reach a font CDN. Only the mechanism has moved —
 * upstream's vendored Inter/Instrument Serif, then the `geist` package, now a
 * single vendored Inter subset extracted from the reference screens. The
 * assertions follow the fonts rather than being deleted along with them.
 */

const fontsSource = readFileSync(new URL("../../src/lib/fonts.ts", import.meta.url), "utf8");
const SUBSET = new URL("../../src/assets/fonts/inter/Inter-subset.woff2", import.meta.url);

test("web fonts are local and never use the Google build-time loader", () => {
  assert.match(fontsSource, /next\/font\/local/);
  assert.doesNotMatch(fontsSource, /next\/font\/google/);
  // No remote URL of any kind in the font config.
  assert.doesNotMatch(fontsSource, /https?:\/\//);
});

test("every configured WOFF2 asset is vendored", () => {
  assert.ok(existsSync(SUBSET), "the Inter subset must be committed, not fetched");
  const bytes = readFileSync(SUBSET);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2", "not a WOFF2 file");
  // The reference screens inline this same subset nine times, once per declared
  // weight; all nine payloads are byte-identical, so one file covers 100-900.
  assert.match(fontsSource, /weight:\s*"100 900"/);
});

test("the font config points only at the vendored file", () => {
  const paths = [...fontsSource.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(paths, ["../assets/fonts/inter/Inter-subset.woff2"]);
});

test("the serif stack needs no vendored face", () => {
  // The reference design's --font-serif is Georgia, so the serif-italic hero
  // line uses a system stack. Nothing to download, nothing to license.
  const globals = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
  assert.match(globals, /--font-serif:\s*Georgia/);
});
