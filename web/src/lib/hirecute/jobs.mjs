/**
 * Normalize, deduplicate and filter discovered postings.
 *
 * The provider layer returns its own `Job` shape
 * (`{title, url, company, location, description?, postedAt}`). This module maps
 * that onto hirecute's `Job` contract and enforces the honesty rules from
 * 02-screen-guide.md §5, which are mostly rules about what NOT to fill in:
 *
 *   Posting age       from `postedAt` only; missing stays null
 *   Salary            from a sourced amount or omitted — no sample range
 *   Type/seniority    only if extracted with evidence
 *   Funding/alumni/applicants   absent, always
 *   Recruiter         "Hiring team · Company", never an invented address
 *
 * Dedup is by canonical posting URL (upstream's `url-key.mjs`), with the
 * provider job ID as a secondary key. Two requisitions at one employer must
 * stay distinct — that is an explicit §5 acceptance check — so the company name
 * is never part of the key.
 */

import path from "node:path";

/** Load upstream's canonical URL key so our dedup matches the tracker's. */
async function loadUrlKey(codeRoot) {
  const mod = await import(path.join(codeRoot, "url-key.mjs"));
  return mod.urlKey ?? mod.normalizeUrl ?? mod.default;
}

/** A stable per-run job id derived from the canonical key. */
function jobIdFrom(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `job-${(hash >>> 0).toString(36)}`;
}

/** Only a real ISO-ish date survives. Anything else becomes null, not "now". */
function normalizePostedAt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Providers hand back epoch ms (greenhouse's toEpochMs).
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string") {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
  }
  return null;
}

function inferWorkStyle(location, title) {
  // A conservative read of text the SOURCE provided. No guessing beyond it.
  const haystack = `${location ?? ""} ${title ?? ""}`.toLowerCase();
  if (/\bremote\b/.test(haystack) && !/\b(no|not|non)[- ]?remote\b/.test(haystack)) return "remote";
  if (/\bhybrid\b/.test(haystack)) return "hybrid";
  if (/\b(on-?site|in-?office)\b/.test(haystack)) return "onsite";
  return null;
}

/**
 * Map one provider posting onto the hirecute `Job` contract.
 *
 * `sha256` is passed in so this module stays dependency-free and testable.
 */
export function toHirecuteJob({ providerId, board, posting, canonicalUrl, hash }) {
  const postedAt = normalizePostedAt(posting.postedAt);
  return {
    id: jobIdFrom(canonicalUrl),
    company: posting.company || board.name,
    title: String(posting.title || "").trim(),
    source: {
      provider: ["greenhouse", "lever", "ashby", "workday"].includes(providerId)
        ? providerId
        : "other_public_ats",
      providerJobId: posting.id ? String(posting.id) : null,
      canonicalPostingUrl: canonicalUrl,
      applicationUrl: posting.url || canonicalUrl,
      fetchedAt: new Date().toISOString(),
      postingContentHash: hash,
      // We did not open the page in a browser, so liveness is UNVERIFIED.
      // Claiming "open" from a board listing would be an inference.
      liveStatus: "unverified",
      verifiedAt: null,
    },
    location: posting.location ? String(posting.location).trim() : null,
    workStyle: inferWorkStyle(posting.location, posting.title),
    // Not published in a board listing. Omitted rather than guessed.
    employmentType: null,
    seniority: null,
    experienceYearsMin: null,
    postedAt,
    // §5: "Use source amount/currency/range or omit; no sample range fallback."
    salary: null,
    descriptionArtifactId: null,
    descriptionStatus: posting.description ? "full" : "missing",
    // Never an invented address (§7).
    recruiter: {
      status: "unknown",
      company: posting.company || board.name,
      displayName: `Hiring team · ${posting.company || board.name}`,
      email: null,
      reason: "contact_not_listed",
    },
    evidenceIds: [],
  };
}

/**
 * Normalize + dedup a raw provider harvest.
 *
 * @returns {Promise<{jobs: object[], descriptions: Map<string,string>, duplicates: number}>}
 */
export async function normalizeHarvest({ codeRoot, raw, sha256 }) {
  const urlKey = await loadUrlKey(codeRoot);
  const byKey = new Map();
  const descriptions = new Map();
  let duplicates = 0;

  for (const { board, provider, job: posting } of raw) {
    const url = posting?.url;
    const title = String(posting?.title ?? "").trim();
    // A posting with no URL or no title is not a card we can show or link to.
    if (!url || !title) continue;

    let canonical;
    try {
      canonical = typeof urlKey === "function" ? urlKey(url) : url;
    } catch {
      canonical = url;
    }
    if (!canonical) canonical = url;

    if (byKey.has(canonical)) {
      // The same requisition seen twice — one card, not two.
      duplicates += 1;
      continue;
    }

    const description = typeof posting.description === "string" ? posting.description : "";
    const job = toHirecuteJob({
      providerId: provider,
      board,
      posting,
      canonicalUrl: canonical,
      hash: sha256(`${canonical}\n${title}\n${description}`),
    });
    byKey.set(canonical, job);
    if (description) descriptions.set(job.id, description);
  }

  return { jobs: [...byKey.values()], descriptions, duplicates };
}

/**
 * Score-free relevance filter, applied BEFORE any model call.
 *
 * Deterministic eligibility only: does the title look like the kind of role the
 * resume supports, and does the location fit a stated preference. This is
 * explicitly not fit scoring — that is milestone 5, and it needs a JD.
 *
 * A location preference filters only when the posting states a location. An
 * unstated location is kept: absence of evidence is not evidence of a mismatch.
 */
export function filterRelevant(jobs, { targetRoles = [], locations = [], limit = 40 } = {}) {
  const roleTerms = targetRoles
    .flatMap((r) => String(r).toLowerCase().split(/[^a-z0-9+#]+/))
    .filter((t) => t.length > 2);
  const locTerms = locations.map((l) => String(l).toLowerCase()).filter(Boolean);

  const scored = jobs
    .map((job) => {
      const title = job.title.toLowerCase();
      // Count distinct matched terms, so "product manager" beats "manager".
      const hits = new Set(roleTerms.filter((t) => title.includes(t))).size;
      return { job, hits };
    })
    // With no seed we cannot rank by relevance, so keep everything rather than
    // silently returning nothing.
    .filter(({ hits }) => roleTerms.length === 0 || hits > 0)
    .filter(({ job }) => {
      if (locTerms.length === 0) return true;
      if (!job.location) return true; // unstated location is not a mismatch
      if (job.workStyle === "remote") return true;
      const loc = job.location.toLowerCase();
      return locTerms.some((t) => loc.includes(t) || t.includes(loc));
    });

  // Stable ordering: relevance, then most recently posted, then id. Undated
  // postings sort last among equal relevance rather than being dropped.
  scored.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    const at = a.job.postedAt ? Date.parse(a.job.postedAt) : -Infinity;
    const bt = b.job.postedAt ? Date.parse(b.job.postedAt) : -Infinity;
    if (bt !== at) return bt - at;
    return a.job.id.localeCompare(b.job.id);
  });

  return scored.slice(0, limit).map(({ job }) => job);
}
