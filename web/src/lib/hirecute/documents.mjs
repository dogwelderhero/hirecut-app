/**
 * Document generation, through career-ops's real deterministic utilities.
 *
 * Chain: validated payload JSON → `build-cv-html.mjs` → `generate-pdf.mjs`,
 * with `verify-cv-facts.mjs` as an ADDITIONAL heuristic check. The brief is
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
 *     against the operator's facts. `--source` is always passed explicitly.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
 * Build a CV PDF for one run.
 *
 * @param {object} opts
 * @param {string} opts.codeRoot   Immutable career-ops checkout.
 * @param {string} opts.runDir     This run's data root.
 * @param {Record<string,string>} opts.env  Child env from paths.childEnv().
 * @param {object} opts.payload    Validated payload in build-cv-html shape.
 * @param {string} opts.basename   Server-chosen, e.g. "base-resume".
 * @returns {Promise<{ok: true, html: string, pdf: string, json: string} | {ok: false, stage: string, detail: string}>}
 */
export async function buildCvPdf(opts) {
  const { codeRoot, runDir, env, payload, basename } = opts;
  const outDir = path.join(runDir, "output");
  await mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `${basename}.json`);
  const htmlPath = path.join(outDir, `${basename}.html`);
  const pdfPath = path.join(outDir, `${basename}.pdf`);

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

  // generate-pdf.mjs launches Chromium with JS disabled and remote requests
  // blocked; that behaviour is upstream's and is deliberately not overridden.
  const rendered = await run(
    process.execPath,
    [path.join(codeRoot, "generate-pdf.mjs"), htmlPath, pdfPath, "--format=a4", "--max-pages=2"],
    { cwd: codeRoot, env, timeout: 180_000 },
  );
  if (!rendered.ok) {
    // A failed render leaves the validated HTML in place: §4 says a PDF-only
    // failure should retry rendering, not rerun extraction.
    return { ok: false, stage: "pdf", detail: rendered.stderr.slice(0, 800) || rendered.stdout.slice(0, 800) };
  }

  return { ok: true, html: htmlPath, pdf: pdfPath, json: jsonPath };
}

/**
 * Heuristic fact check of generated text against the run's OWN source.
 *
 * Returns findings, not a verdict. `verify-cv-facts.mjs` catches unsupported
 * metrics and asserted non-metric facts absent from the source; it cannot
 * prove a document is accurate, and the UI must not claim it did.
 */
export async function checkFacts(opts) {
  const { codeRoot, env, documentPath, sourcePath } = opts;
  const result = await run(
    process.execPath,
    [
      path.join(codeRoot, "verify-cv-facts.mjs"),
      documentPath,
      // Explicit: the default would be cv.md / article-digest.md, which under a
      // run root do not exist and must never resolve to the operator's.
      "--source",
      sourcePath,
      "--json",
    ],
    { cwd: codeRoot, env },
  );

  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }

  return {
    // A non-zero exit means findings, which is information, not a crash.
    ran: report !== null,
    findings: report?.findings ?? report?.issues ?? [],
    raw: report,
    detail: report === null ? result.stderr.slice(0, 500) : "",
  };
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
