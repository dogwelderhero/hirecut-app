/**
 * Reading a resume's text into sections — the one parse path.
 *
 * The refine stage and the parse evals (web/evals/parse) both call this, so an
 * eval measures exactly what a visitor gets: the same prompt, schema, model
 * tier and the same validation of the reply.
 */

import { requestStructured, untrusted } from "./model.mjs";
import { RESUME_PARSE_SCHEMA, resumeParseSystem, resumeParseUser } from "./prompts.mjs";
import { SECTION_KEYS, isSectionEmpty, normalizeResume } from "./resume.mjs";

/**
 * @param {string} text  the verbatim extraction of the visitor's file
 * @param {{ request?: typeof requestStructured }} [opts]  the model call (injectable for tests)
 * @returns {Promise<
 *   | { ok: true, resume: object, searchSeed: object, parseData: object, usage: object, model: string }
 *   | { ok: false, reason: "model", error: unknown }
 *   | { ok: false, reason: "unusable", resume: object, parseData: object, usage: object, model: string }
 * >}
 */
export async function parseResume(text, { request = requestStructured } = {}) {
  let response;
  try {
    response = await request({
      tier: "fast",
      system: await resumeParseSystem(),
      user: resumeParseUser(untrusted("RESUME", text)),
      schema: RESUME_PARSE_SCHEMA,
      schemaName: "emit_resume_sections",
      maxTokens: 8192,
    });
  } catch (error) {
    return { ok: false, reason: "model", error };
  }

  // Validation, not trust: coerce to the section shape, and require that the
  // document actually had resume content in it. A reply wrapped one level too
  // deep ({x: {usable, sections}}) is unwrapped rather than read as empty.
  let parseData = response.data ?? {};
  if (parseData.usable === undefined && !parseData.sections) {
    const inner = Object.values(parseData).find((v) => v && typeof v === "object" && ("usable" in v || "sections" in v));
    if (inner) parseData = inner;
  }
  const resume = normalizeResume(parseData.sections ?? parseData.resume);
  const meta = { resume, parseData, usage: response.usage, model: response.model };
  if (parseData.usable === false || SECTION_KEYS.every((k) => isSectionEmpty(resume, k))) {
    return { ok: false, reason: "unusable", ...meta };
  }
  return { ok: true, searchSeed: parseData.searchSeed ?? {}, ...meta };
}
