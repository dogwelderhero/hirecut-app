/**
 * Prompt composition from career-ops mode files.
 *
 * The pack's reuse boundary: mode files are "Prompt sources for the adapter;
 * read their dependencies rather than treating one file as a complete agent."
 * So this module reads them as CONTENT and composes our own instructions — it
 * never dispatches a mode or asks an agent to run one.
 *
 * `modes/cv-ingest.md` does not exist at the pinned commit. Upstream's own
 * `/api/cv/ingest` route handles that with an inline fallback and a comment
 * saying so, and we do the same: read it when it lands, otherwise compose from
 * `_shared.md` + `_writing.md`, which do exist.
 *
 * Only the factual and register rules are lifted. Mode files also contain
 * agent-workflow instructions ("run this script", "write that file") which
 * would be nonsense to a tool-less API call, so each excerpt is bounded.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

/** Read a mode file, or null if it is absent at this pin. */
async function readMode(codeRoot, relative) {
  try {
    return await readFile(path.join(codeRoot, relative), "utf8");
  } catch {
    return null;
  }
}

/**
 * The non-negotiable factual standard, stated in our own words.
 *
 * Derived from AGENTS.md's Source-of-Truth Boundary and `_writing.md`'s
 * "Accuracy always wins over style. … Never invent detail to sound more human."
 * It is stated here rather than quoted wholesale because the originals address
 * an agent with file access, and this call has none.
 */
const FACTUAL_STANDARD = `FACTUAL RULES (these outrank everything else):
- Reorder, reframe and re-word. NEVER invent. Every claim in your output must
  be traceable to the source document.
- Preserve exactly: names, employers, job titles, dates, qualifications and
  every quantified metric. Do not round, soften, upgrade or drop a number.
- Never add a skill, tool, employer, certification or achievement that is not
  in the source.
- Never claim the person authored or built something the source does not
  attribute to them. Using a tool is not building it.
- If something is absent, it stays absent. An unknown is not an empty string,
  a zero, or a reasonable guess.`;

/**
 * ATS register rules for CV text.
 *
 * `_writing.md` is explicit that conversational voice does NOT apply to CV
 * bullets and the summary — those keep a formal, keyword-dense register. The
 * double-hyphen rule comes from upstream's own ingest format.
 */
const CV_REGISTER = `REGISTER (CV text only — not a cover letter):
- Formal and keyword-dense. No first person, no contractions, no hedging.
- Never use an em dash (—) in prose; write "--" instead. ATS parsers mishandle
  em dashes. This does NOT apply to date ranges: write "2021-Present", not
  "2021--Present".
- Strong verb first in each bullet. Keep the metric in the bullet it belongs to.
- No filler adjectives ("passionate", "dynamic", "results-driven").`;

/** The anti-slop lines from career-ops `modes/_writing.md`, bounded. */
async function antiSlop(codeRoot) {
  const writing = await readMode(codeRoot, "modes/_writing.md");
  if (!writing) return null;
  // Only the guardrail lines are relevant; the rest of the file tells an agent
  // to read writing-samples/ and cache results in a profile.
  const lines = writing
    .split("\n")
    .filter((l) => /banned|avoid|never|em-dash|slop/i.test(l))
    .slice(0, 18)
    .join("\n");
  return lines.trim() ? `ANTI-SLOP GUARDRAIL (from career-ops modes/_writing.md):\n${lines}` : null;
}

const entryList = (properties, required = []) => ({
  type: "array",
  items: { type: "object", properties, ...(required.length ? { required } : {}) },
});
const S = { type: "string" };
const SA = { type: "array", items: { type: "string" } };

/** The eleven review sections, as the parse call must emit them. */
const RESUME_PROPERTIES = {
  contact: {
    type: "object",
    properties: {
      name: S,
      email: S,
      phone: S,
      location: S,
      links: entryList({ label: S, url: S }, ["url"]),
    },
  },
  targetTitle: {
    type: "string",
    description: "Only if the resume states a headline or desired title. Otherwise omit.",
  },
  summary: { type: "string", description: "The resume's own summary/profile text, verbatim. Omit if none." },
  experience: entryList({ role: S, company: S, location: S, dates: S, bullets: SA }),
  education: entryList({ title: S, org: S, location: S, year: S, description: S }),
  skills: entryList({ category: S, items: SA }, ["items"]),
  interests: SA,
  certifications: entryList({ title: S, org: S, year: S }),
  awards: { ...entryList({ title: S, org: S, year: S, description: S }), description: "Awards, honours and scholarships." },
  projects: entryList({ name: S, description: S, tech: S, bullets: SA }),
  volunteering: { ...entryList({ role: S, org: S, dates: S, bullets: SA }), description: "Volunteering and leadership roles outside paid employment." },
  publications: entryList({ title: S, venue: S, year: S, description: S }),
};

/** System prompt for reading a resume into sections — no rewriting. */
export async function resumeParseSystem() {
  return [
    "You read a person's resume and sort its content into sections. You are given the raw text of their own document.",
    FACTUAL_STANDARD,
    `THIS IS EXTRACTION, NOT EDITING:
- Copy text exactly as written. Do not rephrase, shorten, correct or improve it.
  Only fix broken spacing that text extraction introduced inside a word.
- Put each piece of content in the one section it belongs to.
- A section the resume does not have is OMITTED. Never write a placeholder,
  never guess, never infer a target title from job history.`,
  ].join("\n\n");
}

/**
 * Schema for the parse call: the sections, plus the search seed Explore needs.
 */
export const RESUME_PARSE_SCHEMA = {
  type: "object",
  properties: {
    usable: {
      type: "boolean",
      description: "False if the text is not a resume or is unreadable. Emit nothing else then.",
    },
    // Named `sections`, not `resume`: with a field named like the document,
    // the model wrapped its whole answer a second time.
    sections: {
      type: "object",
      description: "The resume's own content, verbatim, by section. Omit absent sections.",
      properties: RESUME_PROPERTIES,
    },
    searchSeed: {
      type: "object",
      description: "Derived from the resume, for the job search. Leave a field out if unclear.",
      properties: {
        currentTitle: { type: "string" },
        targetRoles: {
          type: "array",
          items: { type: "string" },
          description: "3-6 role titles this person could credibly apply for.",
        },
        seniority: { type: "string" },
        location: {
          type: "string",
          description:
            "Only where the resume states they are based. This is NOT evidence of work authorization.",
        },
        skills: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["usable"],
};

export function resumeParseUser(untrustedResumeText) {
  return [
    "Sort the resume below into sections, copying its text exactly.",
    "If this is not a readable resume, set `usable: false` and return nothing else.",
    "",
    untrustedResumeText,
  ].join("\n");
}

/** System prompt for per-section improvement recommendations. */
export async function resumeRecommendationSystem(codeRoot) {
  const ingest = await readMode(codeRoot, "modes/cv-ingest.md");
  const slop = await antiSlop(codeRoot);
  return [
    "You suggest improvements to a person's resume, one small change at a time. The person reviews each suggestion and applies it or not.",
    FACTUAL_STANDARD,
    CV_REGISTER,
    // If the mode lands upstream, prefer its instructions over our fallback.
    ingest ? `CAREER-OPS INGEST MODE (authoritative format):\n${ingest.slice(0, 8000)}` : null,
    slop,
    `HOW A RECOMMENDATION WORKS:
- Each one rewrites ONE piece of text in ONE section. \`before\` must be copied
  EXACTLY from that section of the structured resume (a bullet, a sentence, a
  skills line). \`after\` replaces it.
- \`before\` may be "" only for a summary or target title that is currently
  empty, and only when it can be written entirely from facts already in the
  resume.
- Never add a new job, degree, award, project, publication or skill. Never
  change a name, employer, title, date or number.
- Keep each suggestion independent: it must make sense applied alone.
- This is general refinement, not tailoring to a job — no job description exists yet.
- Fewer, better suggestions. An empty list is correct for a resume that already reads well.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const RESUME_RECOMMENDATIONS_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      description: "At most 12. Never pad this to look productive.",
      items: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: [
              "contact",
              "targetTitle",
              "summary",
              "experience",
              "education",
              "skills",
              "certifications",
              "awards",
              "projects",
              "volunteering",
              "publications",
            ],
          },
          kind: { type: "string", enum: ["clarity", "structure", "formatting", "relevance"] },
          label: { type: "string", description: "Button text, 2-6 words, e.g. 'Lead with the outcome'." },
          explanation: { type: "string", description: "Why, in one sentence." },
          before: { type: "string", description: "Exact text currently in that section, or \"\" (see rules)." },
          after: { type: "string", description: "The replacement text." },
        },
        required: ["section", "kind", "label", "explanation", "before", "after"],
      },
    },
  },
  required: ["recommendations"],
};

export function resumeRecommendationUser(resumeJson) {
  return [
    "Suggest improvements to the structured resume below. Quote `before` exactly from it.",
    "",
    resumeJson,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone 5 — evidence-backed matching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scoring standard, lifted from career-ops's own rubric.
 *
 * `modes/_shared.md` § Scoring System defines five dimensions integrated into
 * ONE global 1-5 score, explicitly "no arithmetic formula", with these bands:
 * 4.5+ strong, 4.0-4.4 good, 3.5-3.9 decent, below 3.5 not recommended.
 *
 * Two adaptations, because a hirecute visitor is not the career-ops operator:
 *  - There is no `modes/_profile.md` North Star or comp target for a stranger,
 *    so "target alignment" is measured against the roles derived from THEIR
 *    resume, and an unknown salary cannot move the score either way. The audit
 *    says exactly this: "Adapt archetypes to the actual candidate."
 *  - There is no `culture_screen` config, so that dimension is scored
 *    qualitatively from what the posting actually says, or left out.
 *
 * `oferta.md`'s own separations are preserved: requirement importance and
 * posting legitimacy do NOT feed the numeric score, and work authorization is
 * score-neutral unless the posting states there is no sponsorship.
 */
const SCORING_RUBRIC = `SCORING (career-ops rubric, modes/_shared.md):
Integrate these dimensions into ONE holistic score from 1 to 5. There is no
arithmetic formula — do not average anything.
- CV match: skills, experience and proof points actually evidenced in the resume
- Target alignment: fit against the roles this person's own experience supports
- Compensation: only if the posting states it. An unpublished salary must NOT
  move the score in either direction.
- Cultural/stability signals: only from what the posting says
- Red flags: concrete blockers or warnings in the posting

BANDS: 4.5+ strong · 4.0-4.4 good · 3.5-3.9 decent · below 3.5 not recommended.

SEPARATIONS (do not collapse these into the score):
- Requirement importance is a prioritization surface, not a score input.
- Posting legitimacy is reported separately.
- Work authorization is SCORE-NEUTRAL. Only an explicit "no sponsorship" for a
  role this person could not take is a hard blocker. Silence is "unstated" —
  never infer authorization, and never infer its absence.
- LOCATION AND RELOCATION ARE SCORE-NEUTRAL (modes/oferta.md: "do not apply a
  location or relocation penalty"). Never list a geography difference as a fit
  gap and never let it lower score5. If a posting genuinely cannot be done from
  where this person is, record it as a BLOCKER with code "location" — that is a
  separate eligibility fact, not a measure of how well they fit the work.
  Score the WORK, not the commute.`;

/** No tools, no research, no invented scale. */
const MATCH_DISCIPLINE = `EVIDENCE RULES:
- You have NO tools and NO internet. Everything you assert must come from the
  resume facts or the job description supplied below. Never claim you researched
  the company, checked Glassdoor, or read anything else.
- Every strength must quote or paraphrase something actually present in BOTH the
  resume and the posting. A strength with no evidence is not a strength.
- Gaps are what the posting asks for and the resume does not evidence.
- If the job description is missing or unusable, say so by returning
  scorable: false. Do NOT score a posting you could not read.
- Never invent a salary, headcount, funding stage, applicant count or team size.`;

export async function matchSystem(codeRoot) {
  const shared = await readMode(codeRoot, "modes/_shared.md");
  const oferta = await readMode(codeRoot, "modes/oferta.md");

  const parts = [
    "You assess how well ONE job posting fits ONE candidate, based only on their resume and that posting.",
    SCORING_RUBRIC,
    MATCH_DISCIPLINE,
  ];

  // Lift the evidence-tier and gap guidance from oferta.md's Block B rather
  // than restating it, so the factual standard tracks upstream. The mode also
  // contains agent-workflow steps (liveness gates, report writing, tracker
  // rows) that are meaningless to a tool-less call, so the excerpt is bounded
  // to the lines about evidence.
  if (oferta) {
    const evidence = oferta
      .split("\n")
      .filter((l) => /evidence|stated|inferred|gap|must-have|nice-to-have/i.test(l))
      .slice(0, 20)
      .join("\n");
    if (evidence.trim()) {
      parts.push(`EVIDENCE TIERS (from career-ops modes/oferta.md Block B):\n${evidence}`);
    }
  }

  if (shared) {
    const untrustedRule = shared
      .split("\n")
      .filter((l) => /untrusted|never obey|data, never instructions/i.test(l))
      .slice(0, 8)
      .join("\n");
    if (untrustedRule.trim()) {
      parts.push(`UNTRUSTED CONTENT (from career-ops modes/_shared.md):\n${untrustedRule}`);
    }
  }

  return parts.join("\n\n");
}

/**
 * Schema for one assessment.
 *
 * `score5` is the single canonical number. There is no percentage field: the
 * display value is derived every time by `match.ts` as
 * `round(score5 / 5 * 100)`, so a card can never drift from the stored score.
 */
export const MATCH_SCHEMA = {
  type: "object",
  properties: {
    scorable: {
      type: "boolean",
      description:
        "False if the job description was missing or unusable. Return nothing else then — an unread posting is never scored.",
    },
    score5: {
      type: "number",
      description:
        "Holistic fit, 1 to 5, at most one decimal place. Not a probability of anything.",
    },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    recommendation: { type: "string", enum: ["apply", "consider", "research_first", "skip"] },
    workAuthorization: {
      type: "string",
      enum: ["sponsors", "not_needed", "unstated", "no_sponsorship"],
      description:
        "Only what the posting states. Silence is 'unstated' — never inferred from the candidate's location.",
    },
    legitimacy: {
      type: "string",
      enum: ["high_confidence", "proceed_with_caution", "suspicious"],
      description: "Reported separately; does not feed score5.",
    },
    strengths: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
      description: "Each must cite something present in BOTH the resume and the posting.",
    },
    gaps: {
      type: "array",
      maxItems: 4,
      items: { type: "string" },
      description: "What the posting asks for that the resume does not evidence.",
    },
    requirements: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          requirement: { type: "string" },
          match: { type: "string", enum: ["strong", "partial", "missing", "not_applicable"] },
          explanation: { type: "string" },
        },
        required: ["requirement", "match", "explanation"],
      },
    },
    blockers: {
      type: "array",
      maxItems: 4,
      description: "Hard eligibility stops, kept separate from fit.",
      items: {
        type: "object",
        properties: {
          code: {
            type: "string",
            enum: [
              "work_authorization",
              "location",
              "required_qualification",
              "posting_closed",
              "other",
            ],
          },
          description: { type: "string" },
          certainty: { type: "string", enum: ["confirmed_blocker", "needs_candidate_input"] },
        },
        required: ["code", "description", "certainty"],
      },
    },
    worthChecking: {
      type: "string",
      description: "One short note for the card's 'Worth checking' line. Optional.",
    },
  },
  required: ["scorable"],
};

export function matchUser({ resumeFacts, job, jobDescription }) {
  return [
    "Assess the fit between this candidate and this posting.",
    "",
    `POSTING: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}`,
    job.salary ? `Stated compensation: ${job.salary.advertisedText}` : "Compensation: not stated in the posting.",
    "",
    resumeFacts,
    "",
    jobDescription,
    "",
    "Return the structured assessment. If you could not read the job description, set scorable: false.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Milestone 6 — per-job packages (tailored CV emphasis + one letter)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Letter register.
 *
 * `modes/_writing.md`'s two-tier rule is load-bearing here and cuts the OTHER
 * way from the CV: Tier 2 conversational voice applies to "conversational
 * candidate-facing prose: cover letters, LinkedIn outreach, follow-up emails"
 * and must NOT be applied to CV bullets. So a letter may use first person and
 * contractions where a CV bullet may not.
 *
 * Structure follows `modes/email.md` § Cold application structure: value first,
 * two proof points tied to the company/domain, a specific ask. Explicitly NOT
 * "I am looking for a job".
 */
const LETTER_REGISTER = `LETTER REGISTER (career-ops modes/_writing.md, Tier 2 — conversational prose):
- First person and contractions are fine. This is a letter, not a CV bullet.
- Value proposition FIRST. Never open with "I am looking for a job" or
  "I am writing to apply for".
- Exactly 2 proof points, each tied to this company or this domain, each drawn
  from the candidate's own evidenced experience.
- End with a specific, modest ask — a short call or a conversation.
- No filler adjectives, no flattery about the company's "mission to disrupt",
  no em dashes.
- 4 short paragraphs maximum. A recruiter reads the first two lines.`;

export async function letterSystem(codeRoot) {
  const email = await readMode(codeRoot, "modes/email.md");
  const writing = await readMode(codeRoot, "modes/_writing.md");

  const parts = [
    "You write ONE cover letter for ONE job, from this candidate's own evidenced experience.",
    FACTUAL_STANDARD,
    LETTER_REGISTER,
  ];

  if (email) {
    // Only the structure and guardrail lines. The mode also tells an agent to
    // resolve attachments, pick contacts and write files, none of which applies
    // to a tool-less call.
    const structure = email
      .split("\n")
      .filter((l) => /proof point|value proposition|specific ask|never|guardrail|do not/i.test(l))
      .slice(0, 16)
      .join("\n");
    if (structure.trim()) {
      parts.push(`STRUCTURE (from career-ops modes/email.md):\n${structure}`);
    }
  }

  if (writing) {
    const antiSlop = writing
      .split("\n")
      .filter((l) => /banned|dead phrase|avoid|em-dash/i.test(l))
      .slice(0, 12)
      .join("\n");
    if (antiSlop.trim()) parts.push(`ANTI-SLOP GUARDRAIL:\n${antiSlop}`);
  }

  parts.push(
    `THIS LETTER IS A DRAFT THE CANDIDATE WILL READ AND SEND THEMSELVES. Never
state or imply that it has been sent, that a CV is attached, or that you
contacted anyone. Do not invent a recipient name.`,
  );

  return parts.join("\n\n");
}

/**
 * Package schema: the letter plus the emphasis for this job's tailored CV.
 *
 * `cvEmphasis` is a REORDERING instruction, not new content — it names which of
 * the candidate's existing bullets matter most for this posting. The tailored
 * CV is then built from the SAME payload stage 1 validated, reordered. That is
 * what keeps "keywords get reformulated, never fabricated" true by
 * construction: the builder never receives a sentence the model invented.
 */
export const PACKAGE_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: 'Email subject. Plain, e.g. "Application: {role}".',
    },
    letter: {
      type: "string",
      description:
        "The full letter body, ready to read. Plain text with blank lines between paragraphs. No markdown, no placeholders, no [BRACKETS].",
    },
    summary: {
      type: "string",
      description:
        "A 2-3 line professional summary for the tailored CV, rewritten to lead with what this posting cares about. Facts only from the resume.",
    },
    emphasisOrder: {
      type: "array",
      items: { type: "string" },
      description:
        "The candidate's existing experience bullets, VERBATIM, reordered so the most relevant to this posting come first. Copy them exactly — do not reword, merge or add any.",
    },
  },
  required: ["subject", "letter"],
};

export function packageUser({ resumeFacts, job, jobDescription, assessment }) {
  const evidence = [
    assessment?.strengths?.length
      ? `Assessed strengths for this role:\n${assessment.strengths.map((s) => `- ${s}`).join("\n")}`
      : "",
    assessment?.gaps?.length
      ? `Known gaps (do NOT claim these away, and do not raise them unprompted):\n${assessment.gaps.map((g) => `- ${g}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    `Write the letter and tailoring for this role.`,
    "",
    `ROLE: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}`,
    // No invented recipient. The panel shows "Hiring team · Company".
    `RECIPIENT: unknown. Address the hiring team generically. Do NOT invent a name.`,
    "",
    evidence,
    "",
    resumeFacts,
    "",
    jobDescription,
    "",
    "Return the structured package.",
  ].join("\n");
}
