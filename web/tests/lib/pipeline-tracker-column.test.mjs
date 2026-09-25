import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareTrackerNumbers } from "../../src/lib/pipeline-sort.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "components", "pipeline-view.tsx");
const source = readFileSync(SRC, "utf8");

test("tracker identifiers sort numerically rather than lexicographically", () => {
  const rows = [{ n: "10" }, { n: "2" }, { n: "1" }];
  assert.deepEqual([...rows].sort(compareTrackerNumbers).map(({ n }) => n), ["1", "2", "10"]);
  assert.deepEqual([...rows].sort((a, b) => compareTrackerNumbers(b, a)).map(({ n }) => n), ["10", "2", "1"]);
});

test("Tracker is the first sortable Pipeline column", () => {
  assert.match(source, /const SORT_KEYS = \["tracker", "company", "role", "score", "status", "date"\]/);
});

test("sortable Pipeline headers use native keyboard-operable buttons", () => {
  assert.match(source, /<th[\s\S]*?aria-sort=[\s\S]*?<button\s+type="button"[\s\S]*?onClick=/);
  assert.doesNotMatch(source, /<th(?:(?!>).)*onClick/s);
});

test("the visible tracker identifier uses the canonical tracker route", () => {
  assert.match(source, /<Link href=\{`\/pipeline\/\$\{r\.n\}`\}[^>]*>\s*#\{r\.n\}\s*<\/Link>/);
});

test("the lower-priority Date header and cells hide below the large breakpoint", () => {
  assert.match(source, /k === "date" && "hidden lg:table-cell"/);
  // Asserts the responsive behaviour, not the palette: the colour token in
  // this cell is theme-owned (it moved when the app adopted shadcn's neutral
  // tokens) and pinning the exact className made a re-theme fail a
  // breakpoint test.
  const dateCell = source.match(/<td className="([^"]*)">\{r\.date\}<\/td>/);
  assert.ok(dateCell, "the Date cell should be rendered from r.date");
  const classes = dateCell[1].split(/\s+/);
  for (const required of ["hidden", "lg:table-cell", "whitespace-nowrap", "tabular-nums"]) {
    assert.ok(classes.includes(required), `Date cell should carry ${required}, got: ${dateCell[1]}`);
  }
});
