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

/** Compose the system prompt for resume normalization + general refinement. */
export async function resumeRefinementSystem(codeRoot) {
  const ingest = await readMode(codeRoot, "modes/cv-ingest.md");
  const writing = await readMode(codeRoot, "modes/_writing.md");

  const parts = [
    "You normalize and refine a person's resume. You are given the raw text of their own document.",
    FACTUAL_STANDARD,
    CV_REGISTER,
  ];

  if (ingest) {
    // If the mode lands upstream, prefer its instructions over our fallback.
    parts.push(`CAREER-OPS INGEST MODE (authoritative format):\n${ingest.slice(0, 8000)}`);
  }

  if (writing) {
    // Only the anti-slop guardrail section is relevant; the rest of the file
    // tells an agent to read writing-samples/ and cache results in a profile.
    const antiSlop = writing
      .split("\n")
      .filter((l) => /banned|avoid|never|em-dash|slop/i.test(l))
      .slice(0, 18)
      .join("\n");
    if (antiSlop.trim()) {
      parts.push(`ANTI-SLOP GUARDRAIL (from career-ops modes/_writing.md):\n${antiSlop}`);
    }
  }

  parts.push(
    `THIS PASS IS A GENERAL REFINEMENT, NOT JOB-SPECIFIC TAILORING. No job
description exists yet. Improve clarity, structure and formatting only.`,
  );

  return parts.join("\n\n");
}

/**
 * Schema for the refinement result.
 *
 * `payload` matches `lib/cv-payload-schema.mjs`'s HTML vocabulary
 * (experience: company/role/location/dates/bullets; education:
 * title/org/location/year/description; skills: category/items), because
 * `build-cv-html.mjs` renders nothing for a payload that names them
 * differently — upstream #3523.
 */
export const RESUME_REFINEMENT_SCHEMA = {
  type: "object",
  properties: {
    usable: {
      type: "boolean",
      description: "False if the text is not a resume or is unreadable. Emit nothing else then.",
    },
    candidate: {
      type: "object",
      description:
        "Identity and contact, exactly as build-cv-html.mjs reads it. Omit any field the source does not state — do not guess one.",
      properties: {
        name: { type: "string" },
        location: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        linkedin: {
          type: "object",
          properties: { url: { type: "string" }, display: { type: "string" } },
        },
        github: {
          type: "object",
          properties: { url: { type: "string" }, display: { type: "string" } },
        },
        portfolio: {
          type: "object",
          properties: { url: { type: "string" }, display: { type: "string" } },
        },
      },
      required: ["name"],
    },
    summary: { type: "string", description: "2-4 lines, built only from stated facts." },
    payload: {
      type: "object",
      description: "The CV content, in career-ops build-cv-html payload shape.",
      properties: {
        experience: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string" },
              role: { type: "string" },
              location: { type: "string" },
              dates: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
            },
            required: ["company", "role"],
          },
        },
        projects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              bullets: { type: "array", items: { type: "string" } },
              tech: { type: "string" },
            },
            required: ["name"],
          },
        },
        education: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              org: { type: "string" },
              location: { type: "string" },
              year: { type: "string" },
              description: { type: "string" },
            },
            required: ["title"],
          },
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, org: { type: "string" }, year: { type: "string" } },
            required: ["title"],
          },
        },
        skills: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              items: { type: "array", items: { type: "string" } },
            },
            required: ["items"],
          },
        },
      },
      required: ["experience"],
    },
    changes: {
      type: "array",
      description:
        "One entry per real change you made. If you changed nothing, return an empty array — never pad this to look productive.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["clarity", "structure", "formatting", "relevance"] },
          before: { type: "string", description: "The original text, verbatim." },
          after: { type: "string", description: "Your replacement." },
          explanation: { type: "string", description: "Why, in one sentence." },
        },
        required: ["kind", "before", "after", "explanation"],
      },
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

export function resumeRefinementUser(untrustedResumeText) {
  return [
    "Normalize and refine the resume below.",
    "",
    "Return the structured result. Specifically:",
    "- `payload` is the cleaned CV content.",
    "- `changes` lists ONLY the changes you actually made, with the original text verbatim in `before`. An honest empty array is correct if the resume already reads well.",
    "- `searchSeed` is what a job search should look for. Leave fields out when the resume does not support them.",
    "- If this is not a readable resume, set `usable: false` and return nothing else.",
    "",
    untrustedResumeText,
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
