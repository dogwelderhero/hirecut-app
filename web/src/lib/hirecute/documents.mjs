/**
 * Document generation, through career-ops's real deterministic utilities.
 *
 * Chain: validated payload JSON → `build-cv-html.mjs` (→ `generate-pdf.mjs`
 * only when `FEATURES.pdfGeneration` is on; it is off in the MVP), with
 * `verify-cv-facts.mjs` as an ADDITIONAL heuristic check. The brief is
 * explicit that the fact checker is "not sole proof of factual accuracy", so
 * its findings are recorded and surfaced — never treated as a guarantee.
 *
 * The brief also warns: "Inspect the real signatures before calling; do not
 * assume every helper uses the same data-root convention." Two consequences
 * that are load-bearing here:
 *
 *  1. `build-cv-html.mjs <input.json> <output.html> [template.html]` resolves
 *     its template from the CODE root, so the template path is passed
 *     explicitly rather than left to a DATA_ROOT default that has no
 *     templates/ directory.
 *  2. `verify-cv-facts.mjs` defaults its sources to `cv.md` and
 *     `article-digest.md`. Under a run's data root those do not exist — and if
 *     it ever resolved the operator's, it would be checking a visitor's CV
 *     against the operator's facts. Sources and config are always explicit.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { FEATURES } from "./limits.mjs";

/** Promisified execFile with an argument ARRAY — never a shell string. */
function run(file, args, opts) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { ...opts, maxBuffer: 8 * 1024 * 1024, timeout: opts?.timeout ?? 120_000 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

/**
 * Build a CV for one run: payload JSON → HTML.
 *
 * No PDF. The MVP prototype stops at the validated HTML, which is what the
 * fact check and the preview need; `generate-pdf.mjs` (Chromium) is a
 * second, slower failure point we do not need to carry yet.
 *
 * @param {object} opts
 * @param {string} opts.codeRoot   Immutable career-ops checkout.
 * @param {string} opts.runDir     This run's data root.
 * @param {Record<string,string>} opts.env  Child env from paths.childEnv().
 * @param {object} opts.payload    Validated payload in build-cv-html shape.
 * @param {string} opts.basename   Server-chosen, e.g. "base-resume".
 * @returns {Promise<{ok: true, html: string, json: string} | {ok: false, stage: "html", detail: string}>}
 */
export async function buildCvHtml(opts) {
  const { codeRoot, runDir, env, payload, basename } = opts;
  const outDir = path.join(runDir, "output");

  // `basename` may contain a job-keyed subdirectory (jobs/<id>/cv), so the
  // parent is created rather than assumed.
  await mkdir(path.dirname(path.join(outDir, `${basename}.json`)), { recursive: true });

  const jsonPath = path.join(outDir, `${basename}.json`);
  const htmlPath = path.join(outDir, `${basename}.html`);

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  // The template lives under codeRoot. Passing it explicitly is what keeps the
  // builder from looking for templates/ inside the run's data root.
  const template = path.join(codeRoot, "templates", "cv-template.html");

  const built = await run(
    process.execPath,
    [path.join(codeRoot, "build-cv-html.mjs"), jsonPath, htmlPath, template],
    { cwd: codeRoot, env },
  );
  if (!built.ok) {
    return { ok: false, stage: "html", detail: built.stderr.slice(0, 800) || built.stdout.slice(0, 800) };
  }

  return { ok: true, html: htmlPath, json: jsonPath };
}

/**
 * Build a CV PDF: HTML first, then `generate-pdf.mjs` (Chromium).
 *
 * NOT used in the MVP flow — `FEATURES.pdfGeneration` is off, so
 * `buildCvDocument` never reaches this. Kept intact for later.
 *
 * @returns {Promise<{ok: true, html: string, pdf: string, json: string} | {ok: false, stage: "html"|"pdf", detail: string}>}
 */
export async function buildCvPdf(opts) {
  const { codeRoot, runDir, env, basename } = opts;
  const html = await buildCvHtml(opts);
  if (!html.ok) return html;

  const pdfPath = path.join(runDir, "output", `${basename}.pdf`);
  // generate-pdf.mjs launches Chromium with JS disabled and remote requests
  // blocked; that behaviour is upstream's and is deliberately not overridden.
  const rendered = await run(
    process.execPath,
    [path.join(codeRoot, "generate-pdf.mjs"), html.html, pdfPath, "--format=a4", "--max-pages=2"],
    { cwd: codeRoot, env, timeout: 180_000 },
  );
  if (!rendered.ok) {
    // A failed render leaves the validated HTML in place: §4 says a PDF-only
    // failure should retry rendering, not rerun extraction.
    return { ok: false, stage: "pdf", detail: rendered.stderr.slice(0, 800) || rendered.stdout.slice(0, 800) };
  }
  return { ...html, pdf: pdfPath };
}

/**
 * The one entry point stages call. HTML only while `FEATURES.pdfGeneration`
 * is off; `document` is the file to register as the artifact either way.
 *
 * @returns {Promise<{ok: true, document: string, html: string, json: string, pdf?: string} | {ok: false, stage: string, detail: string}>}
 */
export async function buildCvDocument(opts) {
  const built = FEATURES.pdfGeneration ? await buildCvPdf(opts) : await buildCvHtml(opts);
  if (!built.ok) return built;
  return { ...built, document: built.pdf ?? built.html };
}

/**
 * Heuristic fact check of generated text against the run's OWN source.
 *
 * Returns flags, not a guarantee. `verify-cv-facts.mjs` catches unsupported
 * metrics and some asserted non-metric facts absent from the source; it
 * cannot prove a document is accurate, and the UI must not claim it did.
 *
 * Imported in-process: `verifyFacts()` is a pure function over two strings,
 * so a child process bought nothing — and the earlier child-process version
 * read `findings`/`issues`, fields the script never emits, so every run
 * reported zero findings.
 *
 * @param {object} opts
 * @param {string} opts.codeRoot
 * @param {string} opts.runDir
 * @param {string} opts.text        Generated text to check.
 * @param {string} opts.sourcePath  The run's verbatim source extraction.
 * @returns {Promise<{ran: boolean, verdict: "pass"|"warn"|"block"|null, flags: Array<{kind: string, claim: string}>, detail: string}>}
 */
export async function checkFacts(opts) {
  const { codeRoot, runDir, text, sourcePath } = opts;
  try {
    const { verifyFacts } = await import(
      pathToFileURL(path.join(codeRoot, "verify-cv-facts.mjs")).href
    );
    const result = verifyFacts(text, {
      // Explicit: the defaults are cv.md / article-digest.md and a
      // config/cv-facts.json, which must never resolve to the operator's.
      sourcePaths: [sourcePath],
      configPath: path.join(runDir, "config", "cv-facts.json"),
      cwd: runDir,
    });
    return { ran: true, verdict: result.verdict, flags: factFlags(result), detail: "" };
  } catch (err) {
    return {
      ran: false,
      verdict: null,
      flags: [],
      detail: String(err?.message ?? err).slice(0, 500),
    };
  }
}

/** The checker's report → one flat, de-duplicated list a person can read. */
export function factFlags(result) {
  const flags = [
    ...(result?.invented ?? []).map((claim) => ({ kind: "metric", claim: String(claim) })),
    ...(result?.unsupportedFacts ?? []).map((f) => ({
      kind: String(f?.kind ?? "fact"),
      claim: String(f?.value ?? ""),
    })),
    ...(result?.forbidden ?? []).map((claim) => ({ kind: "phrase", claim: String(claim) })),
  ].filter((f) => f.claim);
  return flags.filter(
    (f, i) => flags.findIndex((o) => o.kind === f.kind && o.claim === f.claim) === i,
  );
}

/**
 * Render the source facts the fact checker compares against.
 *
 * Kept separate from the generated output so the model cannot validate an
 * invented claim against its own rewrite — audit line 121: "Preserve original
 * facts separately from generated output/refined-resume.json".
 */
export function sourceFactsMarkdown(rawResumeText) {
  return `# Source resume (verbatim extraction)\n\n${rawResumeText}\n`;
}
