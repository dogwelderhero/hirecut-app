/**
 * The structured resume shown on the review step — plain ESM so the worker,
 * the API routes and the browser share one implementation.
 *
 * Two rules this module exists to hold:
 *  - The parsed resume is the visitor's OWN content, sectioned. An empty
 *    section stays empty: `normalizeResume` drops blanks, it never fills them.
 *  - A recommendation is a single, deterministic text replacement inside ONE
 *    section. Applying it touches only that section, so "apply only that
 *    recommendation" holds by construction, and the same function produces the
 *    preview in the browser and the resume the worker tailors from.
 */

/** Display order and labels for the review step. */
export const RESUME_SECTIONS = [
  { key: "contact", label: "Contact Information" },
  { key: "targetTitle", label: "Target Title" },
  { key: "summary", label: "Professional Summary" },
  { key: "experience", label: "Work Experience" },
  { key: "education", label: "Education" },
  { key: "skills", label: "Skills & Interests" },
  { key: "certifications", label: "Certifications" },
  { key: "awards", label: "Awards & Scholarships" },
  { key: "projects", label: "Projects" },
  { key: "volunteering", label: "Volunteering & Leadership" },
  { key: "publications", label: "Publications" },
];

export const SECTION_KEYS = RESUME_SECTIONS.map((s) => s.key);

/** Sections whose content is one string, where an empty value may be SET. */
const SCALAR_SECTIONS = new Set(["targetTitle", "summary"]);

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Keep only the named string fields that have content; drop the entry if none do. */
function entry(raw, fields, listFields = []) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const f of fields) {
    const v = str(raw[f]);
    if (v) out[f] = v;
  }
  for (const f of listFields) {
    const v = strList(raw[f]);
    if (v.length) out[f] = v;
  }
  return Object.keys(out).length ? out : null;
}

const entries = (v, fields, listFields) =>
  (Array.isArray(v) ? v : []).map((e) => entry(e, fields, listFields)).filter(Boolean);

/**
 * Coerce untrusted (model) output into the resume shape. Unknown keys are
 * dropped; missing sections become empty — never a placeholder.
 */
export function normalizeResume(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const c = r.contact && typeof r.contact === "object" ? r.contact : {};
  const links = (Array.isArray(c.links) ? c.links : [])
    .map((l) => entry(l, ["label", "url"]))
    .filter((l) => l && l.url);
  const contact = entry(c, ["name", "email", "phone", "location"]) ?? {};
  if (links.length) contact.links = links;

  return {
    contact,
    targetTitle: str(r.targetTitle),
    summary: str(r.summary),
    experience: entries(r.experience, ["role", "company", "location", "dates"], ["bullets"]),
    education: entries(r.education, ["title", "org", "location", "year", "description"]),
    skills: entries(r.skills, ["category"], ["items"]).filter((s) => s.items?.length),
    interests: strList(r.interests),
    certifications: entries(r.certifications, ["title", "org", "year"]),
    awards: entries(r.awards, ["title", "org", "year", "description"]),
    projects: entries(r.projects, ["name", "description", "tech"], ["bullets"]),
    volunteering: entries(r.volunteering, ["role", "org", "dates"], ["bullets"]),
    publications: entries(r.publications, ["title", "venue", "year", "description"]),
  };
}

/** The raw value(s) a section key covers. "skills" includes interests. */
function sectionValue(resume, key) {
  if (key === "skills") return { skills: resume.skills, interests: resume.interests };
  return resume[key];
}

/** Every string inside a value, depth-first, in display order. */
function strings(value) {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** True when a section has nothing to show. Shown with a "!" — never filled in. */
export function isSectionEmpty(resume, key) {
  return strings(sectionValue(resume, key)).length === 0;
}

/** All visible text of one section, for the fact check and tests. */
export function sectionText(resume, key) {
  return strings(sectionValue(resume, key)).join("\n");
}

/** All visible text of the resume, section by section. */
export function resumeText(resume) {
  return SECTION_KEYS.map((k) => sectionText(resume, k)).filter(Boolean).join("\n");
}

/** Replace the first occurrence of `before` inside any string of `value`. */
function replaceFirst(value, before, after, state) {
  if (state.done) return value;
  if (typeof value === "string") {
    const i = value.indexOf(before);
    if (i < 0) return value;
    state.done = true;
    return value.slice(0, i) + after + value.slice(i + before.length);
  }
  if (Array.isArray(value)) return value.map((v) => replaceFirst(v, before, after, state));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceFirst(v, before, after, state);
    return out;
  }
  return value;
}

/**
 * Apply ONE recommendation to its section. Returns a new resume, or null when
 * it does not apply (its `before` text is no longer in that section).
 *
 * `before === ""` is only meaningful for an EMPTY scalar section (a missing
 * summary or target title); everywhere else a recommendation must quote text
 * that is already there, so it can reword but not add new entries.
 */
export function applyRecommendation(resume, rec) {
  if (!rec || !SECTION_KEYS.includes(rec.section)) return null;
  const before = typeof rec.before === "string" ? rec.before : "";
  const after = typeof rec.after === "string" ? rec.after.trim() : "";
  if (!after || before === after) return null;

  if (!before) {
    if (!SCALAR_SECTIONS.has(rec.section) || resume[rec.section]) return null;
    return { ...resume, [rec.section]: after };
  }

  const state = { done: false };
  if (rec.section === "skills") {
    const next = replaceFirst({ skills: resume.skills, interests: resume.interests }, before, after, state);
    return state.done ? { ...resume, skills: next.skills, interests: next.interests } : null;
  }
  const next = replaceFirst(resume[rec.section], before, after, state);
  return state.done ? { ...resume, [rec.section]: next } : null;
}

/**
 * Apply the chosen recommendations, in the order given. One that no longer
 * applies (an earlier one already rewrote its text) is skipped, not forced.
 */
export function applyRecommendations(resume, recommendations, appliedIds) {
  let out = resume;
  for (const id of appliedIds ?? []) {
    const rec = (recommendations ?? []).find((r) => r.id === id);
    const next = rec ? applyRecommendation(out, rec) : null;
    if (next) out = next;
  }
  return out;
}

/**
 * The resume → career-ops `build-cv-html.mjs` payload.
 *
 * The builder has no block for a target title, volunteering or publications,
 * so those stay review-only rather than being forced into a section that
 * would misdescribe them.
 */
export function toCvPayload(resume) {
  const c = resume.contact ?? {};
  const candidate = {};
  if (c.name) candidate.name = c.name;
  if (c.email) candidate.email = c.email;
  if (c.phone) candidate.phone = c.phone;
  if (c.location) candidate.location = c.location;
  for (const link of c.links ?? []) {
    const url = link.url;
    const kind = /linkedin\.com/i.test(url) ? "linkedin" : /github\.com/i.test(url) ? "github" : "portfolio";
    if (!candidate[kind]) candidate[kind] = { url, display: link.label || url.replace(/^https?:\/\//, "") };
  }
  return {
    candidate,
    summary: resume.summary ?? "",
    // The builder renders no line for an entry missing either field.
    experience: resume.experience.filter((e) => e.company && e.role),
    projects: resume.projects.filter((p) => p.name),
    education: resume.education.filter((e) => e.title),
    certifications: resume.certifications.filter((e) => e.title),
    // The builder reads title/org/year; a description has no slot there.
    awards: resume.awards.filter((a) => a.title).map(({ description: _omit, ...rest }) => rest),
    skills: resume.skills,
    interests: resume.interests,
  };
}

// ── Item tree: what the review step shows inside each section ────────────
//
// Every item has a PATH into the resume ("experience.0", "experience.0.bullets.2",
// "skills.1.items.0", "contact.email"). The same paths drive the checkbox tree
// in the browser and `excludeItems` in the worker, so an unchecked box removes
// exactly the item it was drawn for. Recommendations only replace text, never
// add or remove items, so paths stay stable after one is applied.

const joinMeta = (parts) => parts.filter(Boolean).join(" · ");
const leaf = (path, text) => ({ path, text });

/** The tree of items in one section. Nodes: {path, text, meta?, children?}. */
export function sectionNodes(resume, key) {
  switch (key) {
    case "contact": {
      const c = resume.contact ?? {};
      return [
        ...["name", "email", "phone", "location"].filter((f) => c[f]).map((f) => leaf(`contact.${f}`, c[f])),
        ...(c.links ?? []).map((l, i) => leaf(`contact.links.${i}`, l.label || l.url)),
      ];
    }
    case "targetTitle":
    case "summary":
      return resume[key] ? [leaf(key, resume[key])] : [];
    case "experience":
      return resume.experience.map((e, i) => ({
        path: `experience.${i}`,
        text: joinMeta([e.role, e.company]),
        meta: joinMeta([e.location, e.dates]),
        children: (e.bullets ?? []).map((b, j) => leaf(`experience.${i}.bullets.${j}`, b)),
      }));
    case "education":
      return resume.education.map((e, i) => ({
        path: `education.${i}`,
        text: e.title ?? e.org ?? "",
        meta: joinMeta([e.title ? e.org : undefined, e.location, e.year]),
        children: e.description ? [leaf(`education.${i}.description`, e.description)] : [],
      }));
    case "skills":
      return [
        ...resume.skills.map((s, i) => ({
          path: `skills.${i}`,
          text: s.category || "Skills",
          children: s.items.map((it, j) => leaf(`skills.${i}.items.${j}`, it)),
        })),
        ...(resume.interests.length
          ? [{ path: "interests", text: "Interests", children: resume.interests.map((x, j) => leaf(`interests.${j}`, x)) }]
          : []),
      ];
    case "certifications":
      return resume.certifications.map((c, i) => ({ path: `certifications.${i}`, text: c.title ?? c.org ?? "", meta: joinMeta([c.title ? c.org : undefined, c.year]) }));
    case "awards":
      return resume.awards.map((a, i) => ({
        path: `awards.${i}`,
        text: a.title ?? a.org ?? "",
        meta: joinMeta([a.title ? a.org : undefined, a.year]),
        children: a.description ? [leaf(`awards.${i}.description`, a.description)] : [],
      }));
    case "projects":
      return resume.projects.map((p, i) => ({
        path: `projects.${i}`,
        text: p.name ?? "",
        meta: p.tech,
        children: [
          ...(p.description ? [leaf(`projects.${i}.description`, p.description)] : []),
          ...(p.bullets ?? []).map((b, j) => leaf(`projects.${i}.bullets.${j}`, b)),
        ],
      }));
    case "volunteering":
      return resume.volunteering.map((v, i) => ({
        path: `volunteering.${i}`,
        text: joinMeta([v.role, v.org]),
        meta: v.dates,
        children: (v.bullets ?? []).map((b, j) => leaf(`volunteering.${i}.bullets.${j}`, b)),
      }));
    case "publications":
      return resume.publications.map((p, i) => ({
        path: `publications.${i}`,
        text: p.title ?? "",
        meta: joinMeta([p.venue, p.year]),
        children: p.description ? [leaf(`publications.${i}.description`, p.description)] : [],
      }));
    default:
      return [];
  }
}

/** Every item path in the resume — what the accept route validates against. */
export function itemPaths(resume) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n.path);
      walk(n.children ?? []);
    }
  };
  for (const key of SECTION_KEYS) walk(sectionNodes(resume, key));
  return out;
}

/** True when the item, or anything containing it, is unchecked. */
export function isExcluded(excluded, path) {
  const set = excluded instanceof Set ? excluded : new Set(excluded);
  const parts = path.split(".");
  for (let i = parts.length; i > 0; i--) {
    if (set.has(parts.slice(0, i).join("."))) return true;
  }
  return false;
}

/**
 * Toggle one checkbox. Checking or unchecking a parent resets its children,
 * so a re-checked entry comes back whole rather than half-excluded.
 */
export function toggleExclusion(excluded, path) {
  const next = new Set(excluded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  for (const p of [...next]) if (p.startsWith(`${path}.`)) next.delete(p);
  return [...next];
}

/** The resume without its unchecked items. Section shape is preserved. */
export function excludeItems(resume, excluded) {
  if (!excluded || excluded.length === 0) return resume;
  const set = new Set(excluded);
  const REMOVED = Symbol("removed");
  const prune = (value, path) => {
    if (path && set.has(path)) return REMOVED;
    if (Array.isArray(value)) {
      return value.map((v, i) => prune(v, `${path}.${i}`)).filter((v) => v !== REMOVED);
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const r = prune(v, path ? `${path}.${k}` : k);
        if (r !== REMOVED) out[k] = r;
      }
      return out;
    }
    return value;
  };
  // Top-level keys keep their type: an unchecked summary is "", a list is [].
  const out = {};
  for (const [k, v] of Object.entries(resume)) {
    const r = prune(v, k);
    out[k] = r === REMOVED ? (Array.isArray(v) ? [] : typeof v === "string" ? "" : {}) : r;
  }
  return out;
}

/** The resume the visitor accepted: applied recommendations, minus unchecked items. */
export function acceptedResume(resume, recommendations, acceptance) {
  const applied = applyRecommendations(resume, recommendations, acceptance?.appliedRecommendationIds ?? []);
  return excludeItems(applied, acceptance?.excludedItems ?? []);
}
