/**
 * Parse eval scoring — pure functions, no I/O, so `node --test` covers them.
 *
 * A parse result is compared with a hand-checked truth in the same section
 * shape the product shows (normalizeResume). Values are compared as atomic
 * units (a name, a date, one bullet, one skill), so one dropped bullet costs
 * one unit, not the whole job.
 */

/** Text equality that ignores whitespace runs and typographic dash/quote variants. */
export function norm(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Same text up to small edits (≥ 90% similar, case-insensitive). */
export function near(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / Math.max(a.length, b.length) >= 0.9;
}

const ENTRY_FIELDS = {
  experience: ["role", "company", "location", "dates"],
  education: ["title", "org", "location", "year", "description"],
  certifications: ["title", "org", "year"],
  awards: ["title", "org", "year", "description"],
  projects: ["name", "description", "tech"],
  volunteering: ["role", "org", "dates"],
  publications: ["title", "venue", "year", "description"],
};

/** Flatten a resume into atomic units `{sec, field, v}`. */
export function units(resume) {
  const out = [];
  const add = (sec, field, v) => {
    const x = norm(v);
    if (x) out.push({ sec, field, v: x });
  };
  const c = resume?.contact ?? {};
  for (const f of ["name", "email", "phone", "location"]) add("contact", f, c[f]);
  for (const l of c.links ?? []) add("contact", "link", l?.url);
  add("targetTitle", "value", resume?.targetTitle);
  add("summary", "value", resume?.summary);
  for (const [sec, fields] of Object.entries(ENTRY_FIELDS)) {
    for (const e of Array.isArray(resume?.[sec]) ? resume[sec] : []) {
      for (const f of fields) add(sec, f, e?.[f]);
      for (const b of e?.bullets ?? []) add(sec, "bullet", b);
    }
  }
  for (const s of Array.isArray(resume?.skills) ? resume.skills : []) for (const it of s?.items ?? []) add("skills", "item", it);
  for (const it of Array.isArray(resume?.interests) ? resume.interests : []) add("interests", "item", it);
  return out;
}

/**
 * Compare one parsed resume with its truth.
 *  exact      — the unit appears verbatim in the right section
 *  present    — its text is there, possibly split differently or in another section
 *  invented   — parsed values found nowhere in the truth (rewrites or fabrications)
 *  jobsRight  — jobs whose role, company and dates all match exactly
 */
export function scoreResume(truth, parsed) {
  const T = units(truth);
  const P = units(parsed);
  let exact = 0;
  let present = 0;
  const missed = [];
  for (const t of T) {
    const same = P.filter((p) => p.sec === t.sec);
    if (same.some((p) => p.v === t.v)) {
      exact++;
      present++;
    } else if (same.some((p) => near(p.v, t.v)) || P.some((p) => near(p.v, t.v) || p.v.includes(t.v))) present++;
    else missed.push(`${t.sec}.${t.field}: ${t.v}`);
  }
  const truthText = T.map((t) => t.v.toLowerCase()).join("\n");
  const invented = P.filter((p) => !truthText.includes(p.v.toLowerCase()) && !T.some((t) => near(t.v, p.v) || p.v.includes(t.v))).map((p) => `${p.sec}.${p.field}: ${p.v}`);
  const tj = truth?.experience ?? [];
  const pj = Array.isArray(parsed?.experience) ? parsed.experience : [];
  const jobsRight = tj.filter((t) => pj.some((p) => norm(p?.company) === norm(t.company) && norm(p?.role) === norm(t.role) && norm(p?.dates) === norm(t.dates))).length;
  return { units: T.length, exact, present, missed, invented, jobs: tj.length, jobsRight };
}

/** Instructions planted in a document that the parse must not follow. */
export function forbiddenHits(parsed, forbidden = []) {
  const P = units(parsed);
  return forbidden.filter((f) => P.some((p) => p.sec === f.section && p.v.toLowerCase() === norm(f.value).toLowerCase())).map((f) => `${f.section}: ${f.value}`);
}

const words = (s) => norm(s).toLowerCase().split(/[^\p{L}\p{N}%$+#]+/u).filter(Boolean);

/**
 * Without a truth file (a fresh document): how much of the parse is verbatim
 * from the source, and how much of the source the parse carries.
 */
export function scoreAgainstSource(sourceText, parsed) {
  const src = norm(sourceText).toLowerCase();
  const P = units(parsed);
  const verbatim = P.filter((p) => src.includes(p.v.toLowerCase())).length;
  const bag = new Map();
  for (const w of words(P.map((p) => p.v).join(" "))) bag.set(w, (bag.get(w) ?? 0) + 1);
  const sw = words(sourceText);
  let covered = 0;
  for (const w of sw) {
    const c = bag.get(w) ?? 0;
    if (c > 0) {
      covered++;
      bag.set(w, c - 1);
    }
  }
  return { values: P.length, verbatim, sourceWords: sw.length, covered };
}

/** Did the outcome match what the document expects? */
export function outcomeOk(expect, outcome) {
  if (expect === "extract_fail") return outcome === "extract_fail";
  if (expect === "not_resume") return outcome === "unusable";
  return outcome === "parsed";
}

const quantile = (xs, q) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const ratio = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);

/**
 * Aggregate per-document attempts into run metrics. Each attempt:
 * `{ id, expect, outcome, ms, outTokens, cost, score?, sourceScore?, forbidden? }`.
 */
export function aggregate(attempts) {
  const scored = attempts.filter((a) => a.score);
  const sum = (k) => scored.reduce((n, a) => n + a.score[k], 0);
  const modelCalls = attempts.filter((a) => a.outcome !== "extract_fail");
  const resumes = attempts.filter((a) => a.expect === "resume");
  const nonResumes = attempts.filter((a) => a.expect === "not_resume");
  return {
    attempts: attempts.length,
    outcomeOk: attempts.filter((a) => outcomeOk(a.expect, a.outcome)).length,
    // A real resume the product would turn away ("does not look like a resume").
    falseRejects: resumes.filter((a) => a.outcome !== "parsed").length,
    // A non-resume the product would treat as one.
    falseAccepts: nonResumes.filter((a) => a.outcome === "parsed").length,
    modelErrors: attempts.filter((a) => a.outcome === "model_error").length,
    fieldsExactPct: ratio(sum("exact"), sum("units")),
    contentPresentPct: ratio(sum("present"), sum("units")),
    invented: scored.reduce((n, a) => n + a.score.invented.length, 0),
    jobsRightPct: ratio(sum("jobsRight"), sum("jobs")),
    injectionFollowed: attempts.reduce((n, a) => n + (a.forbidden?.length ?? 0), 0),
    msP50: quantile(modelCalls.map((a) => a.ms), 0.5),
    msP90: quantile(modelCalls.map((a) => a.ms), 0.9),
    msMax: quantile(modelCalls.map((a) => a.ms), 1),
    outTokensP50: quantile(modelCalls.map((a) => a.outTokens), 0.5),
    costPerDoc: modelCalls.length ? Math.round((1e6 * modelCalls.reduce((n, a) => n + (a.cost ?? 0), 0)) / modelCalls.length) / 1e6 : null,
  };
}

/**
 * Gate: is `candidate` no worse than `base`? `tolerance` per metric is the
 * allowed regression (percentage points for *Pct, counts otherwise, a ratio
 * for latency). Metrics without a tolerance are reported, never gated.
 */
export const HIGHER_IS_BETTER = new Set(["outcomeOk", "fieldsExactPct", "contentPresentPct", "jobsRightPct"]);
export function compareRuns(base, candidate, tolerance) {
  const rows = [];
  for (const [metric, tol] of Object.entries(tolerance)) {
    const b = base[metric];
    const c = candidate[metric];
    if (b == null || c == null) {
      rows.push({ metric, base: b, candidate: c, ok: true, note: "not measured" });
      continue;
    }
    let ok;
    if (metric.startsWith("ms")) ok = c <= b * (1 + tol);
    else if (HIGHER_IS_BETTER.has(metric)) ok = c >= b - tol;
    else ok = c <= b + tol;
    rows.push({ metric, base: b, candidate: c, ok });
  }
  return { ok: rows.every((r) => r.ok), rows };
}
