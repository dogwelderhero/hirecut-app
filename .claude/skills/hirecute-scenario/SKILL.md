---
name: hirecute-scenario
description: >-
  Add or change a hirecute scenario (journey), a worker step, a workspace
  screen, a landing block or landing copy in web/. Use when asked to build a
  new flow or hypothesis, add a stage or screen, reorder steps, change what the
  landing shows, or split traffic between journeys.
---

# Scenarios, steps, screens and landing blocks

First read `.claude/rules/hirecute-web.md`: the map, the run lifecycle and the
working rules. Agree the design with the product owner before writing code. A
scenario is a product decision.

## Pieces of a scenario

`web/scenarios/<id>.json` holds four things:

- `pipeline`: steps by reference (`<step-id>@<version>`). `after` sets the
  order and must form a DAG.
- `resultStage`: the stage whose result ends the run.
- `flow`: what the visitor sees.
  - `stages`: exactly the stage slots the pipeline reports into, in order.
    The slots are `refine`, `explore`, `match`, `improve`, `prepare`.
  - `steps`: the visible steps. Each step has a `title` and its `stages`. A
    browser-only step has `"local": true` and no stages.
  - `screens`: a screen id (from `SCREEN_IDS` in `src/lib/hirecute/flow.mjs`)
    for each stage.
  - `packing`: stages whose result stays on screen, then packs into its
    receipt.
  - `absorbed`: stages with no result screen of their own.
  - `shell`: optional shell features, `credits` and `retryButton`.
- `landing.blocks`: the landing page, as blocks in order.

`validateScenario` checks all of this, and so do preflight and `npm test`.
Its errors say what is wrong. Fix the JSON rather than the validator.

## Add a scenario

1. Copy the closest scenario to `web/scenarios/<new-id>.json`. Set `id` (it
   must match the file name), `version: 1`, `title` and `description`.
2. Reuse existing steps where you can. Add a new step only where the
   behaviour differs ("Add a step" below).
3. Write the flow, then the landing blocks. Add copy that differs from
   `content/strings/common.json` to `content/strings/<new-id>.json`.
4. Add the scenario to the shipped-scenarios test in
   `tests/hirecute/scenarios.test.mjs`. That test pins which steps each
   scenario runs.
5. Turn it on for testing only. Set `HIRECUTE_SCENARIOS="vacancy=50;recruiter=50;<new-id>=0"`;
   weight 0 means the scenario is reachable by `/?t=<new-id>` and gets no
   traffic. Give it real traffic only when the product owner decides to.

## Add a step (or a new version of one)

Never edit a step that a shipped scenario uses in a way that changes its
behaviour. Add `<id>@<n+1>` and point the scenario at the new version.
`workers/legacy/v1/` is frozen.

1. **Manifest**, `web/workers/steps/<id>@<version>.json`:
   ```json
   {
     "id": "<id>", "version": 1, "stage": "<slot>",
     "module": "../stages/<file>.mjs", "export": "run<Name>Stage",
     "description": "what it does, in one line",
     "reads":  { "argName": "context.key", "maybe": "other.key?" },
     "defaults": { "maybe": {} },
     "writes": { "returnedField": "context.key" },
     "services": { "env": "utilityEnv" },
     "requires": ["chromium"]
   }
   ```
   - A `reads` key ending in `?` is optional.
   - Every required read must be written by a step that runs **before** this
     one, through `after`.
   - Only one step may report into each stage slot.
2. **Code**, in `web/workers/stages/` as plain ESM. Import shared code from
   `web/src/lib/hirecute/*.mjs`, never from `.ts` files or through `@/`.
   - The function receives `ctx`, holding the built-ins (`emit`, `diag`,
     `runDir`, `codeRoot`), its reads and its services.
   - On success it returns `{ ok: true, ...writes }`.
   - On failure it returns `{ ok: false }`, after it has emitted its own
     `action.error` and `stage.error`.
3. **Events.**
   - Emit `stage.started` first.
   - Then one `action.started` / `action.completed` pair per visible action,
     with labels taken from `src/lib/hirecute/action-labels.mjs`.
   - Write artifacts to disk **before** `stage.result`.
   - Complete an action only when its work really holds. No decorative
     progress.
   - Anything the visitor must not see goes to `diag`.
4. **Model calls** go through `requestStructured` in `model.mjs`:
   - pass a `tier` (`fast` or `judgment`);
   - wrap document text with `untrusted(...)`;
   - give a JSON schema.

   A new env setting the step needs must be added to the `childEnv` allowlist
   in `src/lib/hirecute/paths.ts`.
5. **Tests**: unit-test the step's logic in `web/tests/hirecute/`, with the
   model injected or stubbed. `npm test` never calls a model.

## Add a screen

1. Create `src/components/hirecute/workspace/<scenario>/<screen>.tsx`. It
   exports a `ScreenModule`: `{ Screen, receipts?: { [stage]: (ctx) => StageReceipt | null } }`.
   - A screen renders from `runState` and `presentation` (`ScreenProps` in
     `workspace/types.ts`).
   - A receipt returns `null` while its result is still dwelling. Use
     `isDwelling` from `presentation.ts`.
   - Packing styles key off `isPacking`.
2. Add the screen id to `SCREEN_IDS` in `src/lib/hirecute/flow.mjs` and the
   module to `SCREENS` in `workspace/screens.tsx`. A test keeps the two lists
   in step.
3. View state that must survive a refresh goes in `shell.view`:
   - `decision:*` keys are saved on the server;
   - other keys are kept in sessionStorage.

   Do not add local `useState` for anything the visitor would expect to find
   again after a reload.
4. Put the screen's copy in constants or the strings files, not inline in
   JSX.

## Add a landing block or change copy

- **Copy only:** edit `web/content/strings/<scenario>.json` (or `common.json`
  for every scenario). A value can be a variant object
  `{activation_pilot, auto_apply_pilot}`; the server then picks it for the
  launch profile.
- **New block:**
  1. Write the component in `src/components/hirecute/landing/`.
  2. Register it in `LANDING_BLOCKS` (`landing/blocks.tsx`).
  3. Add its entry to `BLOCKS` in `src/lib/hirecute/landing-content.mjs`: the
     string keys it needs, its anchor and its options. A test keeps the two
     registries in step.
  4. Add the block to the scenario's `landing.blocks`.

## Done means

- `npm run typecheck` and `npm test` pass in `web/`.
- `node scripts/preflight.mjs --boot` passes with the new `HIRECUTE_SCENARIOS`.
- The image builds, and every affected scenario has been walked end to end
  with a real model key, including a reload mid-run and the "Start over"
  path. Unit tests cannot see a missing import in a step or a screen that
  never appears.
