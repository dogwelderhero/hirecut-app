/**
 * Evidence checks for matching and gap-based suggestions — plain ESM.
 *
 * The model is asked to quote the job posting and the resume. A quote is only
 * kept if it is really in that text: this is what turns "the model says you
 * match" into "here is the line in the posting, and here is the line in your
 * resume". Comparison ignores case, whitespace runs and typographic quote /
 * dash variants, nothing more — a paraphrase is not a quote.
 */

/** Shortest quote worth showing as evidence; shorter strings match by accident. */
export const MIN_QUOTE_CHARS = 8;

/** Longest quote kept; a paragraph is not a citation. */
export const MAX_QUOTE_CHARS = 300;

/** Fold case, whitespace and typographic variants so a faithful copy matches. */
export function normalizeForMatch(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•●▪‣⁃]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The quote, trimmed, if it appears in `source`; otherwise null.
 * Leading/trailing ellipses and quote marks the model adds are stripped first.
 */
export function verifyQuote(quote, source) {
  let cleaned = String(quote ?? "")
    .trim()
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
  // Strip quote marks only when they wrap the whole quote (the model's framing),
  // not a quote mark that is part of the text itself.
  if (/^["'“‘]/.test(cleaned) && /["'”’]$/.test(cleaned)) cleaned = cleaned.slice(1, -1).trim();
  if (cleaned.length < MIN_QUOTE_CHARS || cleaned.length > MAX_QUOTE_CHARS) return null;
  return normalizeForMatch(source).includes(normalizeForMatch(cleaned)) ? cleaned : null;
}

/**
 * One requirement from the model, with its quotes checked.
 *
 * A requirement whose posting quote cannot be found is dropped: we cannot show
 * the visitor where the job asks for it. A resume quote that cannot be found is
 * removed, and a "strong" claim without it is downgraded to "partial" — the
 * model saying you have something is not evidence that you do.
 */
export function checkRequirement(raw, { jobText, resumeText }) {
  if (!raw || typeof raw.requirement !== "string" || !raw.requirement.trim()) return null;
  const jobQuote = verifyQuote(raw.jobQuote, jobText);
  if (!jobQuote) return null;
  const match = ["strong", "partial", "missing", "not_applicable"].includes(raw.match)
    ? raw.match
    : "partial";
  const resumeQuote = match === "missing" || match === "not_applicable" ? null : verifyQuote(raw.resumeQuote, resumeText);
  return {
    requirement: raw.requirement.trim().slice(0, 160),
    importance: raw.importance === "nice_to_have" ? "nice_to_have" : "must_have",
    match: match === "strong" && !resumeQuote ? "partial" : match,
    explanation: String(raw.explanation ?? "").trim().slice(0, 300),
    jobQuote,
    resumeQuote,
    jobEvidenceIds: [],
    candidateFactIds: [],
  };
}

/**
 * Gaps across every scored job, for the suggestion step: each partial or
 * missing requirement with its verified posting quote and the jobs asking.
 * Requirements with the same normalized wording are merged.
 */
export function collectGaps(assessments, jobs) {
  const byKey = new Map();
  for (const a of assessments ?? []) {
    for (const r of a.requirements ?? []) {
      if (r.match !== "partial" && r.match !== "missing") continue;
      if (!r.jobQuote) continue;
      const key = normalizeForMatch(r.requirement);
      const job = jobs?.[a.jobId] ?? (Array.isArray(jobs) ? jobs.find((j) => j.id === a.jobId) : null);
      const entry = byKey.get(key) ?? {
        requirement: r.requirement,
        importance: r.importance ?? "must_have",
        match: r.match,
        jobs: [],
      };
      if (r.match === "missing") entry.match = "missing";
      if (r.importance === "must_have") entry.importance = "must_have";
      if (!entry.jobs.some((j) => j.jobId === a.jobId)) {
        entry.jobs.push({
          jobId: a.jobId,
          title: job?.title ?? "",
          company: job?.company ?? "",
          jobQuote: r.jobQuote,
          resumeQuote: r.resumeQuote ?? null,
        });
      }
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .sort((a, b) =>
      b.jobs.length !== a.jobs.length
        ? b.jobs.length - a.jobs.length
        : a.importance === b.importance
          ? 0
          : a.importance === "must_have"
            ? -1
            : 1,
    )
    .map((g, i) => ({ id: `gap-${i + 1}`, ...g }));
}
