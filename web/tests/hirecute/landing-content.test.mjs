import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCKS,
  checkLanding,
  loadLandingContent,
  requiredKeys,
  validateLanding,
} from "../../src/lib/hirecute/landing-content.mjs";
import { format, mergeStrings, resolveVariants } from "../../src/lib/hirecute/landing-strings.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CODE_ROOT = path.dirname(WEB);

// ── pure helpers ─────────────────────────────────────────────────────────────

test("variants resolve to the launch profile at any depth; other objects are left alone", () => {
  const v = { activation_pilot: "ready to send", auto_apply_pilot: "we send it" };
  const value = { items: ["a", v], faq: [{ q: "x", a: "y" }] };
  assert.deepEqual(resolveVariants(value, "activation_pilot"), { items: ["a", "ready to send"], faq: [{ q: "x", a: "y" }] });
  assert.deepEqual(resolveVariants(value, "auto_apply_pilot").items[1], "we send it");
});

test("a scenario's strings override common, and $comment keys are not strings", () => {
  assert.deepEqual(mergeStrings({ a: "1", b: "2", $comment: "doc" }, { b: "3", $comment: "doc" }), { a: "1", b: "3" });
});

test("format fills known parameters and leaves unknown ones visible", () => {
  assert.equal(format("up to {maxMb} MB, {who}", { maxMb: 10 }), "up to 10 MB, {who}");
});

// ── validation ───────────────────────────────────────────────────────────────

const strings = (blocks, extra = {}) => {
  const out = {};
  for (const k of requiredKeys(blocks)) out[k] = k.endsWith("items") || k.endsWith("links") || k.endsWith("rows") || k.endsWith("brands") ? [] : k;
  return { ...out, ...extra };
};

test("a complete landing validates", () => {
  const blocks = [{ block: "hero", anchor: "top" }, { block: "faq", anchor: "faqs" }];
  assert.deepEqual(validateLanding("x", blocks, strings(blocks)), { errors: [], warnings: [] });
});

test("unknown blocks and options, duplicates, missing keys are errors", () => {
  const blocks = [{ block: "hero" }, { block: "hero" }, { block: "carousel" }, { block: "upload", glitter: true }];
  const s = strings([{ block: "hero" }]);
  const { errors } = validateLanding("x", blocks, s);
  const all = errors.join("\n");
  assert.match(all, /block "hero" appears twice/);
  assert.match(all, /unknown block "carousel"/);
  assert.match(all, /block "upload" has unknown option "glitter"/);
  assert.match(all, /missing string "upload.dropTitle"/);
});

test("an enabled option makes its strings required", () => {
  const blocks = [{ block: "upload", recruiterMessage: true }];
  const s = strings([{ block: "upload" }]);
  assert.match(validateLanding("x", blocks, s).errors.join(), /missing string "upload.activity.message.text"/);
});

test("a nav or footer link to an anchor no block carries is an error", () => {
  const blocks = [{ block: "hero", anchor: "top" }];
  const s = strings(blocks, { "nav.links": [{ label: "How it works", href: "#how-it-works" }] });
  assert.match(validateLanding("x", blocks, s).errors.join(), /How it works.*#how-it-works/);
});

test("two blocks claiming one anchor is an error", () => {
  const blocks = [{ block: "features", anchor: "how-it-works" }, { block: "recruiters", anchor: "how-it-works" }];
  assert.match(validateLanding("x", blocks, strings(blocks)).errors.join(), /anchor "#how-it-works" is used twice/);
});

test("a variant missing a launch profile is an error; an unused string is a warning", () => {
  const blocks = [{ block: "hero", anchor: "top" }];
  const s = strings(blocks, { "hero.lead": { activation_pilot: "only one" }, "hero.typo": "x" });
  const r = validateLanding("x", blocks, s);
  assert.match(r.errors.join(), /"hero.lead" has a variant without every launch profile/);
  assert.match(r.warnings.join(), /"hero.typo" is not used/);
});

// ── the shipped landings ─────────────────────────────────────────────────────

test("both shipped landings are complete, with no stray strings", async () => {
  for (const id of ["vacancy", "recruiter"]) {
    assert.deepEqual(await checkLanding(CODE_ROOT, id), { errors: [], warnings: [] }, id);
  }
});

test("each scenario keeps its version's block order", async () => {
  const order = async (id) => (await loadLandingContent(CODE_ROOT, id, { launchProfile: "activation_pilot" })).blocks.map((b) => b.block);
  assert.deepEqual(await order("vacancy"), ["hero", "upload", "startups", "features", "control", "pricing", "faq", "finale"]);
  assert.deepEqual(await order("recruiter"), ["hero", "upload", "recruiters", "startups", "pricing", "faq", "finale"]);
});

test("submission-off copy reaches the page while submission is off, and only then", async () => {
  const last = async (lp) => (await loadLandingContent(CODE_ROOT, "vacancy", { launchProfile: lp })).strings["pricing.credits.items"].at(-1);
  assert.equal(await last("activation_pilot"), "Every package ready to download and send");
  assert.equal(await last("auto_apply_pilot"), "Submission tracking and follow-up actions");
});

test("the React registry and BLOCKS name the same blocks", async () => {
  const src = await readFile(path.join(WEB, "src", "components", "hirecute", "landing", "blocks.tsx"), "utf8");
  const registry = src.slice(src.indexOf("LANDING_BLOCKS"));
  const keys = [...registry.matchAll(/^\s{2}([a-z][a-z-]*):\s/gm)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), Object.keys(BLOCKS).sort());
});

test("every feature item names an illustration that exists", async () => {
  const art = await readFile(path.join(WEB, "src", "components", "hirecute", "feature-art.tsx"), "utf8");
  const vacancy = JSON.parse(await readFile(path.join(WEB, "content", "strings", "vacancy.json"), "utf8"));
  for (const f of vacancy["features.items"]) assert.ok(art.includes(`"${f.art}": (`), f.art);
});
