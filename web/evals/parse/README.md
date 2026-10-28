# Parse evals

These evals measure how well the product reads a resume into sections: the
extraction plus the `emit_resume_sections` call. The runner calls the product's
own code (`src/lib/hirecute/extract.mjs` and `resume-parse.mjs`), so a result
describes exactly what a visitor gets under a given setup.

## Run

```
npm run eval:parse -- --setup current                   # built-in corpus, 2 reps
npm run eval:parse -- --setup current --only r13-long3  # one document
npm run eval:parse:compare -- --base current --candidate planned
npm run eval:parse:history                              # every saved run
```

The runner needs `HIRECUTE_MODEL_API_BASE_URL` and `HIRECUTE_MODEL_API_KEY` in the
environment, the same variables the app reads. Every run spends tokens, so
`npm test` never runs it. `npm test` does cover the scoring code
(`tests/evals/parse-score.test.mjs`).

## Setups

`setups.json` names the configurations under test. Each setup is an environment
overlay applied before the parse runs, so a setup changes only what an operator
could change in production. The same file holds the model prices used for cost
figures and the gate tolerances.

## What is measured

| Metric | Meaning |
|---|---|
| `outcomeOk` | attempts whose outcome matches the document's `expect` (parsed / not a resume / unreadable) |
| `falseRejects` | real resumes the product would turn away as "not a resume" |
| `falseAccepts` | non-resumes the product would treat as resumes |
| `fieldsExactPct` | truth values found verbatim in the right section |
| `contentPresentPct` | truth values whose text is there, possibly split into fields differently |
| `jobsRightPct` | jobs whose role, company and dates all match exactly |
| `invented` | parsed values that appear nowhere in the truth |
| `injectionFollowed` | instructions planted in a document that the parse obeyed |
| `msP50` / `msP90` / `msMax` | parse wall time (model call and validation), extraction excluded |
| `costPerDoc` | USD, from token usage and `setups.json` prices |

Every run also reports these metrics per layout and per language.

## Results are kept over time

A run on the built-in corpus writes two files:

- `results/runs/<runId>.json`: the metrics, the breakdowns, and one row per
  attempt (outcome, timings, missed and invented values).
- one line in `results/history.jsonl`: the commit, setup, models, corpus
  version and metrics.

Commit both files. Raw model output goes to `results/raw/`, which git ignores.

`compare.mjs` compares only runs that share a corpus version (`corpusHash`).
Changing the corpus therefore starts a new baseline: re-run the base setup
before you compare.

## Corpus

`corpus/` holds synthetic documents only, and this repository is public. All
people, employers and numbers in it are fictional. Each document has three
files:

- `<id>.pdf` or `<id>.docx`: the document itself.
- `<id>.truth.json`: the correct parse in the section shape of
  `emit_resume_sections`. Non-resumes and scans have no truth file.
- `<id>.meta.json`: `expect` (`resume`, `not_resume` or `extract_fail`),
  `layout`, `language`, and, when a document carries planted instructions, the
  `forbidden` values the parse must not produce.

To regenerate the corpus, run `node evals/parse/tools/make-corpus.mjs` (needs
Playwright) and then `python evals/parse/tools/make-docx.py` (needs
python-docx).

### Adding a document

1. Put the file in `corpus/` with a new id.
2. Write `<id>.meta.json`.
3. Write `<id>.truth.json`. To get a first draft, run the eval on that document
   and copy the parsed sections from `results/raw/`. Then check every value
   against the document by hand: a truth file that was never checked measures
   nothing.
4. Re-run the base setup. The corpus version has changed.

### Real resumes

Real resumes never go into this repository. Keep them, with their truth and
meta files, in a private folder of the same layout, and pass that folder with
`--corpus`. `--out` is then required, so that results stay outside the repo.
A document with no truth file is scored against its own extracted text: the
share of parsed values that appear in the source verbatim, and the share of
the source those values cover.
