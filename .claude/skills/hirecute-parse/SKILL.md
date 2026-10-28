---
name: hirecute-parse
description: >-
  Change how hirecute reads a resume into sections, try another model or parse
  mode, and measure it with the parse evals in web/evals/parse. Use when asked
  to speed up or improve resume parsing, compare models, add a parsing
  approach, add documents to the eval corpus, or check that a change did not
  make parsing worse.
---

# Resume parsing and its evals

## Where parsing lives

- `src/lib/hirecute/extract.mjs` gets the text out of the file. PDFs go
  through pdfjs: `text`, and `pageTexts` page by page. DOCX goes through
  mammoth. Scans with no text layer are refused (`image_only`). There is no
  OCR.
- `src/lib/hirecute/resume-parse.mjs` turns that text into the sections
  (`emit_resume_sections`). This is the **only** parse path. The recruiter
  scenario's refine step (`workers/stages/refine.mjs`) and the evals both
  call `parseResume`. The vacancy scenario's frozen refine
  (`workers/legacy/v1`) is a different call, a rewrite, and is not affected.
- The prompt and schema are `resumeParseSystem`, `resumeParseUser` and
  `RESUME_PARSE_SCHEMA` in `prompts.mjs`. Changing them changes the product.
  Measure before and after.

Modes (`HIRECUTE_PARSE_MODE`):

| Mode | What it does |
|---|---|
| `single` (default) | one call on the fast tier, which falls back to `HIRECUTE_MODEL` |
| `paged` | PDF pages read in parallel on the fast tier. Each reply is repaired locally first (`repairParse`). If still invalid, it is corrected once in the same conversation (`correctionTurn`). The merged result must pass `qualityProblems` against the source text. Anything that fails, including a fast-tier "not a resume", is re-read by the single call on the judgment tier, so the worst case equals the old behaviour. |

## Rules

- **Not worse than now is the bar.** A new mode or model ships behind a flag
  and is turned on only after `compare` passes against the current setup.
- **Falling back to today's behaviour is the safety net, not an option.** A
  new path must end in the old call whenever its own checks fail.
- **Keep one path.** Add a mode inside `resume-parse.mjs` and choose it by an
  env setting. Do not fork the stage or let the evals call model code
  directly: the evals must measure exactly what visitors get.
- **New settings travel to the worker** only through the `childEnv` allowlist
  in `src/lib/hirecute/paths.ts`.
- **Thresholds are calibrated, not guessed.** `QUALITY` in `resume-parse.mjs`
  must be checked against eval runs when the model or corpus changes.

## Add a parse mode or try a model

1. Write the design down first: what changes, why it should be faster or
   better, and how it falls back.
2. Implement it in `resume-parse.mjs` behind a value of `HIRECUTE_PARSE_MODE`
   or a tier setting. Unit-test it with a stubbed `request` in
   `tests/hirecute/resume-parse.test.mjs`, covering:
   - the success path;
   - each repair;
   - the correction;
   - each fallback;
   - the model-error path.
3. Add a setup to `web/evals/parse/setups.json`. A setup is just an env
   overlay (`env`, `unset`). Add the model's price to `prices` if it is new.
4. Run it:
   ```
   cd web
   npm run eval:parse -- --setup <name> --reps 2
   npm run eval:parse:compare -- --base current --candidate <name>
   ```
   The runner needs `HIRECUTE_MODEL_API_BASE_URL` and `HIRECUTE_MODEL_API_KEY`
   in the environment, and it spends tokens.
5. Commit the code first, then the run. A run records the commit it measured
   (a dirty tree is marked `-dirty`). Commit the new files in
   `results/runs/` and the line added to `results/history.jsonl`, so the
   trend stays readable: `npm run eval:parse:history`.
6. Read the per-document rows in the run file, not only the totals. Look for
   missed values, invented values, fallbacks and their reasons, and the
   per-layout and per-language breakdowns. A small corpus hides a lot in an
   average.

## Grow the corpus

`web/evals/parse/corpus/` holds **synthetic documents only**, because the
repository is public. Each document has three files:

- `<id>.pdf` or `<id>.docx`: the document.
- `<id>.truth.json`: the correct parse, in the schema's section shape.
- `<id>.meta.json`: `expect` (`resume`, `not_resume` or `extract_fail`),
  `layout`, `language`, and `forbidden` values for documents carrying
  planted instructions.

Generated documents come from `tools/make-corpus.mjs` (Playwright) and
`tools/make-docx.py` (python-docx). For a new kind of document (another
layout, language or trap), add it to the generator, so it can be rebuilt.

A truth file is the bar every model is held to. Check every value against the
document by hand. A draft copied from a model's output is a starting point,
never the truth.

Changing the corpus changes its version (`corpusHash`). `compare` matches
only runs on the same version, so re-run the base setup after any corpus
change.

## Real resumes

Real resumes never enter the repository.

- Keep them in a private folder with the same layout, plus truth and meta
  files when you have them.
- Run with `--corpus <private folder> --out <folder outside the repo>`.
- A document without truth is scored against its own text: the share of
  values that are verbatim, and the share of the source covered.

## Done means

- The unit tests for the mode pass, along with `npm test` and
  `npm run typecheck`.
- An eval run of the candidate setup is committed with its code commit.
- `compare` passes against `current`.
- The recruiter journey has been walked end to end with the flag on and with
  it off.
