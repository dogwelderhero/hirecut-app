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
