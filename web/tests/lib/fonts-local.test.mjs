import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// hirecute serves Geist (shadcn/ui's recommended pairing) from the `geist`
// package instead of the woff2 files upstream vendored under src/assets/fonts.
//
// The invariant these tests protect is unchanged, and is the reason they
// exist: a build must never reach Google's font CDN. Only the mechanism moved
// — from our own vendored files to a package that itself wraps
// next/font/local around vendored files. So the assertions follow the fonts to
// their new home rather than being deleted along with them.

const require = createRequire(import.meta.url);
const fontsSource = readFileSync(new URL("../../src/lib/fonts.ts", import.meta.url), "utf8");

// The package restricts its `exports` map, so geist/package.json is not
// resolvable. Anchor on a real export (dist/sans.js) and step up to the
// package root — still layout-agnostic, no hoisting assumption.
const geistRoot = path.resolve(path.dirname(require.resolve("geist/font/sans")), "..");

test("web fonts are local and never use the Google build-time loader", () => {
  assert.doesNotMatch(fontsSource, /next\/font\/google/);
  for (const entry of ["dist/sans.js", "dist/mono.js"]) {
    const source = readFileSync(path.join(geistRoot, entry), "utf8");
    assert.doesNotMatch(source, /next\/font\/google/, `${entry} must not use the Google loader`);
    assert.match(source, /next\/font\/local/, `${entry} must load its faces locally`);
  }
});

test("the app loads Geist Sans and Geist Mono, and nothing else", () => {
  assert.match(fontsSource, /from "geist\/font\/sans"/);
  assert.match(fontsSource, /from "geist\/font\/mono"/);
  // The vendored asset directory is gone; this keeps a second font source from
  // being reintroduced silently.
  assert.equal(
    existsSync(new URL("../../src/assets/fonts", import.meta.url)),
    false,
    "src/assets/fonts is expected to be removed — fonts now come from the geist package",
  );
});

test("every configured WOFF2 asset is vendored", () => {
  const fontsDir = path.join(geistRoot, "dist/fonts");
  const woff2 = readdirSync(fontsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".woff2"));
  assert.ok(woff2.length > 0, "geist must ship its own woff2 faces");
  for (const relativePath of woff2) {
    const bytes = readFileSync(path.join(fontsDir, relativePath));
    assert.equal(
      bytes.subarray(0, 4).toString("ascii"),
      "wOF2",
      `${relativePath} is not a WOFF2 file`,
    );
  }
});

test("the vendored font family includes its license", () => {
  assert.ok(
    existsSync(path.join(geistRoot, "LICENSE.txt")),
    "geist must ship LICENSE.txt alongside its faces",
  );
});
