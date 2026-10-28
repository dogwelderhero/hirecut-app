---
paths:
  - "web/**"
  - ".do/**"
---

# hirecute web: how the product is built

The product is the Next.js app in `web/`. It runs a visitor's resume through a
**scenario**: a pipeline of worker **steps** behind a **flow** of screens and
a **landing** page. Almost everything a product decision changes lives in JSON
and is validated by code, so a new journey should need little or no code.
Before changing anything here, read `web/AGENTS.md` (rules for `web/`) and
this file.

## Map

| What | Where | Validated by |
|---|---|---|
| Scenarios (journeys) | `web/scenarios/<id>.json` | `src/lib/hirecute/scenarios.mjs`, preflight |
| Step manifests | `web/workers/steps/<id>@<version>.json` | `scenarios.mjs` |
| Step code (current) | `web/workers/stages/*.mjs` | step tests, `tests/hirecute/scenario-runner.test.mjs` |
| Step code frozen from production 01083211 | `web/workers/legacy/v1/` | **do not edit**; copy it into a new step instead |
| Step executor | `web/workers/scenario-runner.mjs`, `web/workers/hirecute-runner.mjs` | `scenario-runner.test.mjs` |
| Flow (stages, visible steps, screens, presentation) | `"flow"` in the scenario | `src/lib/hirecute/flow.mjs` (`validateFlow`) |
| Workspace screens | `src/components/hirecute/workspace/{recruiter,vacancy}/*.tsx`, registry `workspace/screens.tsx` | `flow.test.mjs`: registry = `SCREEN_IDS` |
| Persistent shell | `src/components/hirecute/workspace.tsx`, `agent-transcript.tsx`, `stage-progress.tsx` | |
| Presentation timing (dwell, pack, restore) | `src/lib/hirecute/presentation.ts`, `workspace/use-presentation.ts` | `presentation.test.mjs` |
| Landing blocks | `"landing"` in the scenario; registry `components/hirecute/landing/blocks.tsx` and `BLOCKS` in `src/lib/hirecute/landing-content.mjs` | `landing-content.test.mjs` |
| Landing copy | `web/content/strings/common.json` + `<scenario>.json` (override) | preflight |
| Scenario choice per visitor | `HIRECUTE_SCENARIOS`, `HIRECUTE_SCENARIO_PARAM`; `src/proxy.ts`, `landing-router.mjs` | `landing-router.test.mjs` |
| Resume parse | `src/lib/hirecute/resume-parse.mjs` (one path for the product and the evals) | `resume-parse.test.mjs`, parse evals |
| Model adapter and tiers | `src/lib/hirecute/model.mjs` | `preflight.test.mjs` |
| Parse evals | `web/evals/parse/` | `tests/evals/parse-score.test.mjs` |
| Deploy config | `.do/app.yaml`, `web/Dockerfile`, `DEPLOY.md` | `scripts/preflight.mjs --boot/--full` |

## How a run works

1. The visitor's scenario is chosen by the proxy: a `?t=<id>` link, else the
   sticky `hc_scn` cookie, else a weighted draw over `HIRECUTE_SCENARIOS`.
2. An upload creates a run (`api/hirecute/runs`). The in-process queue starts
   **one Node child per run** (`worker-host.ts`), which loads the scenario and
   executes its pipeline in dependency order.
3. A step receives only what its manifest's `reads` lists, plus the built-ins
   (`emit`, `diag`, `runDir`, `codeRoot`). What it returns under `writes` goes
   back into the run context. A step never calls another step directly.
4. The child talks to the parent only through a closed IPC vocabulary. The
   parent is the single writer of the run's event log and snapshot. Each step
   reports progress with `action.*` / `stage.*` events, and each action is
   completed only when its work really holds. Never add an action that only
   decorates.
5. The browser follows the event stream. The flow decides which screen shows
   which stage, and the presentation machine keeps a result on screen (dwell),
   then packs it into its receipt in the sidebar. The flow's `packing` and
   `absorbed` lists choose which stages get that treatment. Timers only
   animate: work, results and counts come from the run.
6. A refresh restores the run from the snapshot. Decisions are stored on the
   server; per-run view state lives in sessionStorage. Nothing replays.

## Configuration, not code

These are operator settings in `.do/app.yaml`. The defaults keep current
behaviour.

| Variable | Effect |
|---|---|
| `HIRECUTE_MODEL` | main model (judgment tier fallback) |
| `HIRECUTE_MODEL_FAST`, `HIRECUTE_MODEL_JUDGMENT` | per-tier models; unset falls back to `HIRECUTE_MODEL` |
| `HIRECUTE_MODEL_FAST_THINKING=off` | sends disabled thinking on the fast tier; only for models that accept it |
| `HIRECUTE_PARSE_MODE=paged` | paged resume parse on the fast tier, with checks and fallback to the main model (recruiter scenario's parse; the vacancy scenario's frozen refine is not affected) |
| `HIRECUTE_SCENARIOS` | enabled scenarios and their traffic weights (sum 100; 0 = link only) |

A new variable the worker needs must also be added to the allowlist in
`childEnv` (`src/lib/hirecute/paths.ts`). The child gets nothing else. If you
forget, the setting silently does nothing inside the worker.

## Working rules

- **Design before code.** Write down the scenario, step contract or screen
  first, and agree it with the product owner. Product decisions belong to the
  client. Speed and reliability work must not change what a visitor sees
  unless that change was asked for.
- **Change behaviour behind a flag** (an env setting or a new scenario/step
  version), not by editing a shipped step in place. Bump the step's version
  (`foo@2`) and point a scenario at it; the old version stays runnable.
- **`workers/legacy/v1` is frozen.** It reproduces production 01083211.
- **Measure before you claim.** A parse change needs a parse eval run, and a
  journey change needs an end-to-end run of the affected scenarios (next
  section).
- **The repository is public.** Never commit keys, real resumes, local paths,
  machine names or run output that contains them. The eval results committed
  under `web/evals/parse/results/` hold metrics and synthetic data only.

## Before every commit

From `web/`:

```
npm run typecheck
npm test            # node --test, no network, no tokens
```

Both must pass. `npm test` does not execute worker steps against a model, and
typecheck does not cover `.mjs` files. A missing import in a step therefore
only shows at run time. After changing a step, a screen or the shell, also:

1. build the image (`docker build -f web/Dockerfile .` from the repo root);
2. run it with a model key;
3. walk every affected scenario end to end (`/?t=<id>`), including a page
   reload mid-run;
4. run `node scripts/preflight.mjs --full` against it.

For a parse or model change, also run the parse evals (the `hirecute-parse`
skill) and commit their results.

## Skills for common tasks

- `.claude/skills/hirecute-scenario`: add or change a scenario, a step, a
  screen, a landing block or landing copy.
- `.claude/skills/hirecute-parse`: change how resumes are parsed, add a parse
  mode or model, run and compare the parse evals, grow the eval corpus.
