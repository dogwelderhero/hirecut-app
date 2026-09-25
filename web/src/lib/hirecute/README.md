# `lib/hirecute` — implementation status

Built against `MVP architecture and screens/hirecute-mvp/` (local-only, gitignored).
Upstream is pinned at `career-ops-hq/career-ops@71554e8` (core 1.34.0, web alpha 0.12.0).

## Milestone 1 — done

The six-screen journey runs end to end on typed fixtures, with the journey
state and the presentation timing as **separate** machines.

| Module | What it owns |
|---|---|
| `contracts.ts` | The pack's proposed contracts, copied verbatim. The source of truth for every shape below. |
| `config.ts` | Typed operator config + pilot limits. `launchProfile` is **derived** from `HIRECUTE_SUBMISSION_ENABLED`, so the browser cannot be told the product auto-applies when it does not. Missing credentials never throw at import. |
| `screens.ts` | Six screens, four stages, and historical hash canonicalization (4→3, 6→5, 8→7, 10→9; 12/17→checkout; 13/14→bulk; 15→upload; 16→explore). A hash chooses a view; `hasRun` decides whether it is allowed. |
| `presentation.ts` | 2000 ms **foreground** dwell + 780 ms pack for refine/explore/match. `prepare` settles in place and never packs. Hidden tab pauses; reduced motion keeps the dwell and drops the travel. |
| `checkout-counter.ts` | The fourth-click rule, all ten sub-rules, as a pure reducer. |
| `run-store.ts` | Reducer over the public NDJSON protocol. `seq` replay guard, `stage.result` as the only terminal success, EOF ⇒ interrupted. |
| `letters.ts` | Drafts keyed by job + generation. A candidate edit outranks a completing model generation. |
| `match.ts` | `round(score5 / 5 * 100)`, derived every time. No stored percentage, no default when unscored. |
| `actions.ts` | The fixed orchestrator vocabulary and receipt copy built from real counts. |
| `fixtures.ts`, `fixture-journey.ts` | Deterministic sample data emitting the real event envelopes. Explicitly a `sample` run. |

Tests: `web/tests/hirecute/*` — 55 assertions covering the counter sub-rules,
the presentation timing, event-protocol correctness, score derivation and hash
fallbacks.

## Not built yet (milestones 2–8)

`session.ts`, `store.ts`, `queue.ts`, `events.ts`, `upstream.ts`, `model.ts`,
`prompts.ts`, `jobs.ts`, `documents.ts`, `billing.ts`, `analytics.ts`,
`submission/`, `web/workers/hirecute-runner.mjs`, and every
`/api/hirecute/*` route.

Consequences of that, stated plainly:

- **No server, no persistence, no ownership.** There are no anonymous sessions,
  no run directories, no `codeRoot` / `dataRoot` split, no worker. Nothing is
  isolated between visitors because nothing is stored.
- **No real work.** No upload parsing, no discovery, no scoring, no documents.
  The journey runs on `fixture-journey.ts`.
- **No billing.** The overlay collects email and save-card consent and then
  says card setup is not configured. There is no SetupIntent, webhook or grant.
- **No submission.** `HIRECUTE_SUBMISSION_ENABLED` defaults false, every
  package is `manual_only`, and the copy is activation-profile throughout.

## Capability profile

**Activation / preparation.** Per the brief, this must not be reported as the
completed auto-apply product: the hero, banner and readiness labels all say
prepare-and-open, never "sent". Enabling the auto-apply profile requires the
milestone-8 `SubmitAdapter` first.
