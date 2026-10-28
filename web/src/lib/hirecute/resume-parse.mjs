/**
 * Reading a resume's text into sections — the one parse path.
 *
 * The refine stage and the parse evals (web/evals/parse) both call this, so an
 * eval measures exactly what a visitor gets: the same prompt, schema, model
 * tier and the same validation of the reply.
 *
 * Two modes, chosen by the operator (HIRECUTE_PARSE_MODE):
 *
 *   single (default)  one call on the fast tier for the whole text — the
 *                     original behaviour, unchanged.
 *   paged             a PDF's pages are read in parallel on the fast tier,
 *                     each reply is repaired locally and, if still invalid,
 *                     corrected once in the same conversation; the merged
 *                     result must pass deterministic checks against the source
 *                     text. Anything that does not pass is re-read by ONE call
 *                     on the judgment tier — the single-mode call — so the
 *                     worst case is today's result, later.
 */

import { correctionTurn, requestStructured, untrusted } from "./model.mjs";
import { RESUME_PARSE_SCHEMA, resumeParseSystem, resumeParseUser } from "./prompts.mjs";
import { SECTION_KEYS, isSectionEmpty, normalizeResume } from "./resume.mjs";

export function parseMode(env = process.env) {
  return env.HIRECUTE_PARSE_MODE?.trim() === "paged" ? "paged" : "single";
}

/** Pages read at once in paged mode. */
const PAGE_CONCURRENCY = 4;
/** In-dialogue corrections before falling back. Each one is a full re-emit. */
const MAX_CORRECTIONS = 1;

const SECTION_PROPS = RESUME_PARSE_SCHEMA.properties.sections.properties;

/**
 * @param {string} text  the verbatim extraction of the visitor's file
 * @param {{ pages?: string[], request?: typeof requestStructured, env?: Record<string,string|undefined> }} [opts]
 *   `pages`: the same text page by page (extract.mjs `pageTexts`); `request`: the model call, injectable for tests.
 * @returns {Promise<
 *   | { ok: true, resume: object, searchSeed: object, parseData: object, usage: object, model: string, trace: object }
 *   | { ok: false, reason: "model", error: unknown, trace: object }
 *   | { ok: false, reason: "unusable", resume: object, parseData: object, usage: object, model: string, trace: object }
 * >}
 *   `trace` says how the result was reached: mode, calls (model + usage each), repairs, corrections, fallback reasons.
 */
export async function parseResume(text, { pages, request = requestStructured, env = process.env } = {}) {
  const trace = { mode: parseMode(env), calls: [], repairs: [], corrections: 0, fallback: null };
  if (trace.mode === "single") return finish(await singleCall(text, "fast", request, trace), trace);

  const fast = await pagedRead(text, pages, request, trace);
  const problems = fast.problems ?? qualityProblems(text, fast.parseData);
  if (!problems.length) return finish(fast, trace);

  // Not good enough to show: today's call decides.
  trace.fallback = problems;
  return finish(await singleCall(text, "judgment", request, trace), trace);
}

/** The original parse: one call, the reply taken as it comes. */
async function singleCall(text, tier, request, trace) {
  try {
    const response = await request({
      tier,
      system: await resumeParseSystem(),
      user: resumeParseUser(untrusted("RESUME", text)),
      schema: RESUME_PARSE_SCHEMA,
      schemaName: "emit_resume_sections",
      maxTokens: 8192,
    });
    trace.calls.push({ tier, model: response.model, usage: response.usage });
    return { parseData: unwrapNested(response.data ?? {}) };
  } catch (error) {
    return { error };
  }
}

/** Validation, not trust: coerce to the section shape and require resume content. */
function finish(read, trace) {
  const last = trace.calls.at(-1);
  const usage = trace.calls.reduce(
    (u, c) => ({ inputTokens: u.inputTokens + (c.usage?.inputTokens ?? 0), outputTokens: u.outputTokens + (c.usage?.outputTokens ?? 0) }),
    { inputTokens: 0, outputTokens: 0 },
  );
  if (read.error) return { ok: false, reason: "model", error: read.error, trace };
  const parseData = read.parseData;
  const resume = normalizeResume(parseData.sections ?? parseData.resume);
  const meta = { resume, parseData, usage, model: last?.model, trace };
  if (isUnusable(parseData, resume)) return { ok: false, reason: "unusable", ...meta };
  return { ok: true, searchSeed: parseData.searchSeed ?? {}, ...meta };
}

function isUnusable(parseData, resume) {
  return parseData.usable === false || SECTION_KEYS.every((k) => isSectionEmpty(resume, k));
}

/** A reply wrapped one level too deep ({x: {usable, sections}}) is unwrapped rather than read as empty. */
function unwrapNested(data) {
  if (data.usable === undefined && !data.sections) {
    const inner = Object.values(data).find((v) => v && typeof v === "object" && ("usable" in v || "sections" in v));
    if (inner) return inner;
  }
  return data;
}

// ── paged mode ────────────────────────────────────────────────────────────────

const PAGE_RULES = `YOU SEE ONE PAGE of a longer resume. Emit only what is on this page.
- If the page starts with bullet points that continue a job from the previous page, emit them as the FIRST experience entry with only "bullets" (no role, company or dates).
- Contact details, summary and title only if they are on this page.`;

async function pagedRead(text, pages, request, trace) {
  const parts = pages && pages.length > 1 ? pages : [text];
  const system = await resumeParseSystem();
  const results = await mapLimited(parts, PAGE_CONCURRENCY, (page, i) =>
    readWithRepair(request, trace, {
      tier: "fast",
      system: parts.length > 1 ? `${system}\n\n${PAGE_RULES}` : system,
      user: resumeParseUser(untrusted(parts.length > 1 ? `RESUME PAGE ${i + 1} OF ${parts.length}` : "RESUME", page)),
      schema: RESUME_PARSE_SCHEMA,
      schemaName: "emit_resume_sections",
      maxTokens: 8192,
    }),
  );
  const failed = results.filter((r) => r.problem);
  if (failed.length) return { problems: failed.map((r) => r.problem) };
  if (results.some((r) => r.data.usable === false)) {
    // A page that is "not a resume" is the judgment tier's call to confirm:
    // turning a real resume away is the failure that costs a visitor.
    return { problems: ["fast tier says not a resume"] };
  }
  return { parseData: parts.length > 1 ? mergePages(results.map((r) => r.data)) : results[0].data };
}

/** One structured read: local repair, then at most MAX_CORRECTIONS re-emits with the errors. */
async function readWithRepair(request, trace, opts) {
  let history;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await request(history ? { ...opts, history } : opts);
    } catch (error) {
      return { problem: `fast tier call failed: ${error?.code ?? error?.message ?? error}` };
    }
    trace.calls.push({ tier: opts.tier, model: response.model, usage: response.usage });
    const { data, repairs } = repairParse(unwrapNested(response.data ?? {}));
    trace.repairs.push(...repairs);
    const errors = validateParse(data);
    if (!errors.length) return { data };
    const next = attempt < MAX_CORRECTIONS ? correctionTurn(response.turn, correctionMessage(errors)) : null;
    if (!next) return { problem: `invalid reply: ${errors.slice(0, 3).join("; ")}` };
    trace.corrections++;
    history = next;
  }
}

function correctionMessage(errors) {
  return `The result does not match the schema:\n- ${errors.slice(0, 20).join("\n- ")}\nCall emit_resume_sections again with the corrected, complete result.`;
}

async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Cheap local repairs of shapes models produce, before asking for a re-emit:
 *  - `sections` returned as a JSON string — sometimes with the rest of the
 *    reply (searchSeed, usable) inside that string;
 *  - a section the schema does not have (e.g. `languages`), which
 *    normalizeResume would silently drop: folded into skills under its name;
 *  - `usable` missing while sections are present (read as usable, as before).
 */
export function repairParse(input) {
  const repairs = [];
  if (!input || typeof input !== "object") return { data: input, repairs };
  let data = { ...input };
  if (typeof data.sections === "string") {
    const raw = data.sections;
    try {
      data.sections = JSON.parse(raw);
      repairs.push("sections-string");
    } catch {
      try {
        data = { ...data, ...JSON.parse(`{"sections":${raw}`) };
        repairs.push("sections-string-spill");
      } catch {
        // left as is; validation reports it
      }
    }
  }
  const sections = data.sections;
  if (sections && typeof sections === "object" && !Array.isArray(sections)) {
    data.sections = { ...sections };
    for (const key of Object.keys(sections)) {
      if (SECTION_PROPS[key]) continue;
      const items = (Array.isArray(sections[key]) ? sections[key] : [sections[key]])
        .map((x) => (x && typeof x === "object" ? Object.values(x).filter((v) => typeof v === "string" && v.trim()).join(" — ") : String(x ?? "").trim()))
        .filter(Boolean);
      delete data.sections[key];
      if (items.length) {
        const skills = Array.isArray(data.sections.skills) ? data.sections.skills : [];
        data.sections.skills = [...skills, { category: key.charAt(0).toUpperCase() + key.slice(1), items }];
      }
      repairs.push(`folded:${key}`);
    }
    if (data.usable === undefined) {
      data.usable = true;
      repairs.push("usable-missing");
    }
  }
  return { data, repairs };
}

/** Closed-schema check of a parse reply: every field known, every type right. */
export function validateParse(data) {
  return walk(data, RESUME_PARSE_SCHEMA, "", []);
}

function walk(node, schema, path, errors) {
  const at = path || "the result";
  if (schema.type === "object") {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      errors.push(`${at} must be an object, got ${Array.isArray(node) ? "an array" : typeof node}`);
      return errors;
    }
    for (const key of Object.keys(node)) {
      const p = path ? `${path}.${key}` : key;
      if (!schema.properties?.[key]) errors.push(`${p} is not a field of the schema; put that content in an existing field`);
      else walk(node[key], schema.properties[key], p, errors);
    }
    for (const key of schema.required ?? []) if (!(key in node)) errors.push(`${path ? `${path}.` : ""}${key} is required`);
  } else if (schema.type === "array") {
    if (!Array.isArray(node)) errors.push(`${at} must be an array, got ${typeof node}`);
    else node.forEach((x, i) => walk(x, schema.items, `${path}[${i}]`, errors));
  } else if (schema.type === "string" && typeof node !== "string") {
    errors.push(`${at} must be a string`);
  } else if (schema.type === "boolean" && typeof node !== "boolean") {
    errors.push(`${at} must be true or false`);
  }
  return errors;
}

const PLACEHOLDER = /^[<[(]?\s*(unknown|n\/?a|tbd|null|none|not (specified|provided|available))\s*[>\])]?$/i;
const blankOrPlaceholder = (v) => v == null || !String(v).trim() || PLACEHOLDER.test(String(v).trim());

/**
 * A page's first experience entry that only carries bullets continues the
 * previous page's last job. Models mark the missing header in different ways —
 * leaving it out, as asked, or filling "<UNKNOWN>" — so both count.
 */
function isContinuation(entry) {
  return Boolean(entry) && ["role", "company", "dates"].every((k) => blankOrPlaceholder(entry[k]));
}

/**
 * Page results merged: lists concatenated in page order, single values from
 * the first page that has them, a leading continuation entry joined to the
 * previous page's last job, and the search seed from page 1 with every page's
 * skills.
 */
export function mergePages(parts) {
  const sections = {};
  const seed = { ...(parts[0]?.searchSeed ?? {}) };
  for (const part of parts) {
    for (const [key, value] of Object.entries(part?.sections ?? {})) {
      if (Array.isArray(value)) {
        let items = value;
        const head = value[0];
        if (key === "experience" && sections.experience?.length && isContinuation(head)) {
          const prev = sections.experience.at(-1);
          prev.bullets = [...(prev.bullets ?? []), ...(head.bullets ?? [])];
          items = value.slice(1);
        }
        sections[key] = [...(sections[key] ?? []), ...items.map((x) => (x && typeof x === "object" ? { ...x } : x))];
      } else if (key === "contact" && value && typeof value === "object") {
        sections.contact = { ...value, ...(sections.contact ?? {}) };
      } else if (sections[key] === undefined) {
        sections[key] = value;
      }
    }
    const skills = part?.searchSeed?.skills;
    if (part !== parts[0] && Array.isArray(skills)) seed.skills = [...new Set([...(seed.skills ?? []), ...skills])];
  }
  return { usable: true, sections, searchSeed: seed };
}

// ── deterministic checks of a fast-tier result ────────────────────────────────

const fold = (s) => String(s ?? "").normalize("NFKC").replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const words = (s) => fold(s).split(/[^\p{L}\p{N}%$+#]+/u).filter(Boolean);

function strings(node, out = []) {
  if (typeof node === "string") {
    if (node.trim()) out.push(node);
  } else if (Array.isArray(node)) node.forEach((x) => strings(x, out));
  else if (node && typeof node === "object") Object.values(node).forEach((x) => strings(x, out));
  return out;
}

/** Thresholds for `qualityProblems`, calibrated on the parse evals (see web/evals/parse). */
export const QUALITY = {
  /** Share of the source's words the parse must carry. Sonnet's parses cover 95–100%. */
  minCoverage: 0.85,
  /** Share of parsed values allowed to be absent from the source verbatim (reformatted skill levels and the like). */
  maxNotInSource: 0.2,
};

/**
 * Why a fast-tier parse must not be shown, or [] when it may. Compared with
 * the source text only — no second model, no guess.
 */
export function qualityProblems(sourceText, parseData) {
  const problems = [];
  const resume = normalizeResume(parseData?.sections ?? parseData?.resume);
  const values = strings(resume);
  const source = fold(sourceText);

  const placeholders = values.filter((v) => PLACEHOLDER.test(v.trim()) && !source.includes(fold(v)));
  if (placeholders.length) problems.push(`placeholder values: ${[...new Set(placeholders)].slice(0, 3).join(", ")}`);

  if (values.length >= 5) {
    const absent = values.filter((v) => !source.includes(fold(v))).length;
    if (absent / values.length > QUALITY.maxNotInSource) problems.push(`${absent} of ${values.length} values are not in the source`);
  }

  const bag = new Map();
  for (const w of words(values.join(" "))) bag.set(w, (bag.get(w) ?? 0) + 1);
  const sourceWords = words(sourceText);
  let covered = 0;
  for (const w of sourceWords) {
    const n = bag.get(w) ?? 0;
    if (n > 0) {
      covered++;
      bag.set(w, n - 1);
    }
  }
  if (sourceWords.length && covered / sourceWords.length < QUALITY.minCoverage) {
    problems.push(`covers ${Math.round((100 * covered) / sourceWords.length)}% of the source`);
  }

  const years = sourceText.match(/\b(19|20)\d{2}\b/g)?.length ?? 0;
  if (years >= 3 && isSectionEmpty(resume, "experience")) problems.push("no experience although the source has dates");

  return problems;
}
