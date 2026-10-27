/**
 * Partner-firm recruiters shown on the landing page. The data lives in
 * web/content/recruiters.json; this module types it and adds the helpers.
 *
 * PLACEHOLDERS: these names and bios are illustrative, not real people, and the
 * photos in web/public/recruiters/ are Unsplash stock portraits (Unsplash
 * License). Replace every entry with a real recruiter from the partner firm
 * (with their consent) before this ships. `photo` is a path under web/public;
 * when it is null the card shows initials. Recruiter sessions
 * and ongoing support have no separate price: they are part of the hirecute
 * subscription, alongside the builder.
 */

import recruitersContent from "../../../content/recruiters.json";

export interface Recruiter {
  name: string;
  industry: string;
  bio: string;
  photo: string | null;
  /**
   * A sample exchange: a job seeker's real problem, the recruiter's reply, and
   * the follow-up they might type next (shown in the input).
   */
  chat: { ask: string; answer: string; followUp: string };
  /** Specialisms shown as hashtags on the showcase card. */
  tags: readonly string[];
}

export const RECRUITERS = (recruitersContent as { recruiters: Recruiter[] }).recruiters as ReadonlyArray<Recruiter>;

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

/** Words that point a resume or job title at each recruiter's industry. */
const INDUSTRY_WORDS: Record<string, readonly string[]> = {
  Finance: ["finance", "financial", "bank", "fund", "fintech", "payment", "investment", "analyst", "accounting", "risk", "trading", "audit"],
  Tech: ["engineer", "developer", "software", "product", "data", "devops", "frontend", "backend", "platform", "machine learning", "ai ", "saas"],
  Healthcare: ["health", "clinical", "nurse", "hospital", "medical", "patient", "pharma", "care"],
  "Sales & Marketing": ["sales", "marketing", "growth", "brand", "account executive", "seo", "content", "business development", "partnership"],
  Consulting: ["consult", "strategy", "transformation", "advisory"],
  "Operations & Supply Chain": ["operations", "logistics", "supply", "manufacturing", "procurement", "warehouse", "retail", "fulfil"],
};

/**
 * The recruiters whose industry best fits this text (target title, job titles,
 * summary). Ties keep the list order; with no signal at all, the first `count`.
 */
export function pickRecruiters(text: string, count = 3) {
  const t = ` ${text.toLowerCase()} `;
  return RECRUITERS.map((r, i) => ({
    r,
    i,
    score: (INDUSTRY_WORDS[r.industry] ?? []).reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0),
  }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, count)
    .map((x) => x.r);
}
