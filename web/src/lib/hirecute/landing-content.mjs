/**
 * Landing content: which blocks a scenario's landing shows, in what order, and
 * the strings they render.
 *
 *   web/scenarios/<id>.json          "landing": { "blocks": [{ "block": "hero" }, ...] }
 *   web/content/strings/common.json  strings every scenario shares
 *   web/content/strings/<id>.json    the scenario's own strings; override common
 *
 * A string value may be text, a list, a list of objects, or a variant object
 * {activation_pilot, auto_apply_pilot}: the server picks the variant for its
 * launch profile, so a claim the product cannot keep (auto-apply while
 * submission is off) never reaches a browser. "{name}" is a parameter.
 *
 * BLOCKS is the registry's data half — what each block needs. The React half
 * (block → component) is components/hirecute/landing/blocks.tsx; a test keeps
 * the two in step. Plain ESM so preflight validates exactly what the page uses.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { LAUNCH_PROFILES, isVariant, mergeStrings, resolveVariants } from "./landing-strings.mjs";

export { LAUNCH_PROFILES, format, mergeStrings, resolveVariants } from "./landing-strings.mjs";

/** Keys every landing renders, whatever its blocks (nav and footer). */
export const SHELL_KEYS = ["brand", "nav.links", "footer.tagline", "footer.links", "footer.copyright"];

/**
 * Block id → strings it needs, its default anchor, and the options it accepts.
 * An option's `keys` are required only when the option is on.
 */
export const BLOCKS = {
  hero: {
    anchor: "top",
    keys: ["hero.eyebrow", "hero.title", "hero.titleEm", "hero.lead"],
  },
  upload: {
    keys: [
      "upload.dropTitle", "upload.dropHint", "upload.button", "upload.formats", "upload.reassurance",
      "upload.error.type", "upload.error.empty", "upload.error.size",
      "upload.activity.title", "upload.activity.nextLabel", "upload.activity.nextValue",
      "upload.activity.rows", "upload.activity.prompt",
    ],
    options: {
      recruiterMessage: {
        keys: [
          "upload.activity.message.text", "upload.activity.message.time", "upload.activity.message.role",
          "upload.activity.message.typing", "upload.activity.message.typingLabel",
        ],
      },
    },
  },
  recruiters: {
    anchor: "how-it-works",
    keys: [
      "recruiters.kicker", "recruiters.title", "recruiters.titleLine2", "recruiters.lead",
      "recruiters.filterAll", "recruiters.filterLabel", "recruiters.prev", "recruiters.next",
    ],
  },
  startups: { keys: ["startups.lead", "startups.brands"] },
  features: {
    anchor: "how-it-works",
    keys: ["features.kicker", "features.title", "features.titleEm", "features.lead", "features.items", "features.outro", "features.cta"],
  },
  control: { keys: ["control.kicker", "control.items"] },
  pricing: {
    anchor: "pricing",
    keys: [
      "pricing.kicker", "pricing.title", "pricing.titleEm", "pricing.lead",
      "pricing.free.badge", "pricing.free.title", "pricing.free.price", "pricing.free.lead", "pricing.free.items", "pricing.free.cta", "pricing.free.foot",
      "pricing.credits.badge", "pricing.credits.title", "pricing.credits.price", "pricing.credits.priceNote", "pricing.credits.lead",
      "pricing.credits.items", "pricing.credits.cta", "pricing.credits.foot",
    ],
  },
  faq: { anchor: "faqs", keys: ["faq.kicker", "faq.title", "faq.titleEm", "faq.lead", "faq.items"] },
  finale: { keys: ["finale.kicker", "finale.title", "finale.titleEm", "finale.lead", "finale.upload", "finale.sample", "finale.note"] },
};

export function contentDir(codeRoot) {
  return path.join(codeRoot, "web", "content");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

/**
 * Everything the page needs for one scenario, resolved for this deployment.
 * @returns {Promise<{scenario: string, blocks: Array<{block: string, anchor?: string, [option: string]: unknown}>, strings: Record<string, unknown>}>}
 */
export async function loadLandingContent(codeRoot, scenarioId, { launchProfile }) {
  const { blocks, strings } = await loadRawLanding(codeRoot, scenarioId);
  return { scenario: scenarioId, blocks, strings: resolveVariants(strings, launchProfile) };
}

async function loadRawLanding(codeRoot, scenarioId) {
  const scenario = await readJson(path.join(codeRoot, "web", "scenarios", `${scenarioId}.json`));
  const dir = path.join(contentDir(codeRoot), "strings");
  const common = await readJson(path.join(dir, "common.json"));
  const own = await readJson(path.join(dir, `${scenarioId}.json`));
  const blocks = (scenario.landing?.blocks ?? []).map((b) => ({ anchor: BLOCKS[b.block]?.anchor, ...b }));
  return { blocks, strings: mergeStrings(common, own) };
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Keys this block list needs: the shell, every block's, and every enabled option's. */
export function requiredKeys(blocks) {
  const keys = new Set(SHELL_KEYS);
  for (const b of blocks) {
    const spec = BLOCKS[b.block];
    if (!spec) continue;
    for (const k of spec.keys) keys.add(k);
    for (const [opt, o] of Object.entries(spec.options ?? {})) if (b[opt]) for (const k of o.keys) keys.add(k);
  }
  return [...keys];
}

/**
 * @returns {{errors: string[], warnings: string[]}}
 *   errors   — would break or blank the page: unknown block/option, missing key,
 *              a variant missing a profile, a duplicate block or anchor
 *   warnings — a string no block uses (dead copy, or a typo of a real key)
 */
export function validateLanding(scenarioId, blocks, strings) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(`${scenarioId} landing: ${m}`);
  if (!Array.isArray(blocks) || !blocks.length) err("no blocks");
  const seenBlocks = new Set();
  const seenAnchors = new Set();
  for (const b of blocks ?? []) {
    const spec = BLOCKS[b?.block];
    if (!spec) {
      err(`unknown block "${b?.block}" (known: ${Object.keys(BLOCKS).join(", ")})`);
      continue;
    }
    if (seenBlocks.has(b.block)) err(`block "${b.block}" appears twice`);
    seenBlocks.add(b.block);
    for (const opt of Object.keys(b)) {
      if (opt !== "block" && opt !== "anchor" && !(opt in (spec.options ?? {}))) err(`block "${b.block}" has unknown option "${opt}"`);
    }
    const anchor = b.anchor ?? spec.anchor;
    if (anchor) {
      if (seenAnchors.has(anchor)) err(`anchor "#${anchor}" is used twice`);
      seenAnchors.add(anchor);
    }
  }
  const needed = requiredKeys(blocks ?? []);
  for (const k of needed) {
    if (!(k in strings)) err(`missing string "${k}"`);
  }
  for (const [k, v] of Object.entries(strings)) {
    if (!needed.includes(k)) warnings.push(`${scenarioId} landing: string "${k}" is not used by any block`);
    const bad = findBrokenVariant(v);
    if (bad) err(`string "${k}" has a variant without every launch profile (${LAUNCH_PROFILES.join(", ")})`);
  }
  for (const link of [...asArray(strings["nav.links"]), ...asArray(strings["footer.links"])]) {
    const href = link?.href;
    if (typeof href === "string" && href.startsWith("#") && !seenAnchors.has(href.slice(1))) {
      err(`link "${link.label}" points to #${href.slice(1)}, which no block on this landing has`);
    }
  }
  return { errors, warnings };
}

const asArray = (v) => (Array.isArray(v) ? v : []);

/** An object that names a launch profile but is not a complete variant. */
function findBrokenVariant(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    if (Object.keys(v).some((k) => LAUNCH_PROFILES.includes(k)) && !isVariant(v)) return true;
    return Object.values(v).some(findBrokenVariant);
  }
  return Array.isArray(v) && v.some(findBrokenVariant);
}

/** Load and validate one scenario's landing from disk (preflight, tests). */
export async function checkLanding(codeRoot, scenarioId) {
  try {
    const { blocks, strings } = await loadRawLanding(codeRoot, scenarioId);
    return validateLanding(scenarioId, blocks, strings);
  } catch (e) {
    return { errors: [`${scenarioId} landing: ${e instanceof Error ? e.message : String(e)}`], warnings: [] };
  }
}
