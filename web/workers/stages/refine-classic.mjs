/**
 * Refine for the vacancy journey, v2: the frozen production refine
 * (legacy/v1, 01083211) unchanged, plus the resume read into sections for the
 * reading screen.
 *
 * Step 1 now shows the recruiter's reading animation (sections fill in one by
 * one) while the classic refine works, then its before/after. The sections come
 * from the same `parseResume` the recruiter uses, run alongside the refine.
 * They are display only: `resume.progress` and `resume.parsed` events, never a
 * write. The refine, its result and its writes are v1's, so explore, match and
 * prepare get exactly what they got before.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { extractResumeText } from "../../src/lib/hirecute/extract.mjs";
import { parseResume } from "../../src/lib/hirecute/resume-parse.mjs";
import { runRefineStage as runFrozenRefine } from "../legacy/v1/stages/refine.mjs";

/** The preserved original, whatever extension it was stored under (as v1 finds it). */
async function findOriginal(runDir) {
  const dir = path.join(runDir, "originals");
  const entries = await readdir(dir).catch(() => []);
  const hit = entries.find((f) => /^resume\.(pdf|docx|txt)$/i.test(f));
  return hit ? path.join(dir, hit) : null;
}

/**
 * Read the resume into sections and publish them for the screen. Never throws
 * and never fails the stage: without it the screen keeps its reading skeleton
 * until the refine's result.
 * @param {(ctx: object) => Promise<{resume: object} | null>} [parse]  injectable for tests
 */
export async function publishSections(ctx, parse = readSections) {
  const { emit, diag } = ctx;
  try {
    const read = await parse(ctx);
    if (read) emit("resume.parsed", { resume: read.resume }, "refine");
  } catch (err) {
    diag({ displayParseError: String(err?.message ?? err) });
  }
}

async function readSections({ emit, diag, runDir }) {
  const original = await findOriginal(runDir);
  if (!original) return null;
  const extracted = await extractResumeText(await readFile(original));
  if (!extracted.ok) return null;
  const parsed = await parseResume(extracted.text, {
    pages: extracted.pageTexts,
    onProgress: (progress) => emit("resume.progress", progress, "refine"),
  });
  diag({ displayParse: { ok: parsed.ok, trace: parsed.trace } });
  return parsed.ok ? { resume: parsed.resume } : null;
}

/** @param {object} ctx  as legacy/v1's refine */
export async function runRefineStage(ctx) {
  // v1 announces the stage synchronously, so the sections never arrive before it.
  const refine = runFrozenRefine(ctx);
  // Not awaited: the refine's result never waits for the reading animation.
  void publishSections(ctx);
  return refine;
}
