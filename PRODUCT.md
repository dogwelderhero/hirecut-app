# hirecute

A product built on [career-ops](https://github.com/career-ops-hq/career-ops) (MIT).
Fork of `career-ops-hq/career-ops`; upstream is wired as the `upstream` remote.

## Branch layout

| Branch | Role |
|---|---|
| `main` | **Pristine mirror of upstream. Never commit here.** Keeps GitHub's "Sync fork" working forever. |
| `product` | All hirecute work. Merge `main` in when you want upstream fixes. |

```bash
git checkout main && git pull upstream main     # stays a clean fast-forward
git checkout product && git merge main          # conflicts surface on your schedule
git diff main..product                          # exactly what we changed from upstream
```

`update-system.mjs` is **disabled** — upstream it rewrites ~315 system files in
place, which in this fork means reverting the product. Updates come via git only.

## Local dev

```bash
docker compose up -d        # Postgres 17 on host port 5433
cd web && PORT=3100 npm run dev
```

The Next app runs **on the host**, not in Docker: HMR stays fast and
`generate-pdf.mjs`'s Playwright Chromium uses the host browser. Only stateful
services are containerized. Host port is **5433** to avoid colliding with a
native Postgres.

| Thing | Where |
|---|---|
| Postgres | `localhost:5433`, db/user `hirecute`, password `hirecute_dev` |
| Schema | `db/init/01-schema.sql` — applied once, only on an empty volume |
| Connection string | `.env` (gitignored), template in `.env.example` |
| psql | `docker exec -it hirecute-db psql -U hirecute -d hirecute` |
| Reset the DB | `docker compose down -v && docker compose up -d` |

Schema changes: editing `db/init/*.sql` only affects a **fresh** volume. Either
`down -v` to re-init, or apply a migration by hand once there's real data.

## What we keep, what we replace

The product is three things out of upstream's ~129 root scripts:

| Keep | Why |
|---|---|
| `providers/` (~100 modules) | The moat. Zero-auth ATS adapters, no cross-provider coupling, directory-scan registration — upstream fixes fast-forward cleanly *provided we never edit them*. Needs `lib/ascii-fold.mjs` + `user-agent.mjs`, which providers import via `../`. |
| `build-cv-html.mjs`, `cv-sections-core.mjs`, `lib/cv-payload-schema.mjs` | payload JSON → HTML |
| `generate-pdf.mjs` | exports `renderHtmlToPdf(html, out, opts)` / `renderBatch()`; takes an injectable `launchBrowser` — the hook for a browser pool |
| `verify-ats.mjs` | deterministic ATS score, good product surface |
| `url-key.mjs` | canonical posting-URL key = our dedup/idempotency key |
| `web/src/app/*`, `web/src/components/*` | the UI foundation (Next 16 / React 19) |
| `web/src/app/api/*` route *contracts* | sensible request/response shapes; rewrite the bodies |

### The porting seam: `web/src/lib/core/` (~17 files)

Upstream's web app is **local-first**: route handlers `spawn()` the `.mjs`
scripts as child processes and parse streamed JSON, with markdown files as
state and `careerOpsRoot()` pointing at one checkout on disk.

```ts
// web/src/lib/core/scan.ts — the pattern to replace
const args = [rootScript("scan-ats-full"), "--dry-run", ...];
const child = spawn(process.execPath, args, {...});
```

Correct for a single-user tool, a dead end for a product: spawn-per-request
won't take concurrency and markdown-as-state has no tenancy story.

| File | Action |
|---|---|
| `scan.ts` | **Replace** — spawn → `loadProviders()` + own orchestrator → Postgres |
| `pipeline.ts`, `tracker-lock.ts`, `safe-write.ts`, `pdf-index.ts` | **Delete** — exist only because state is files; `tracker-lock` becomes a DB transaction |
| `states.ts`, `url-key.mjs`, `normalize-text-key.mjs`, `portals-serialize.mjs` | **Keep** — pure logic |
| `api/cv-pdf` + `web/src/lib/cv/` | **Rewrite** — call `renderHtmlToPdf()` in-process with a browser pool, not a shell-out |
| `api/run`, `api/runs`, `api/clis`, `api/assistant`, `api/memory`, `api/usage` | **Drop** — these drive the user's *local* AI CLI (BYO keys); we call models server-side |
| `api/doctor`, `api/version`, `api/whats-new` | **Drop** — local-install concerns |

Out of scope entirely: tracker/follow-up/analytics/interview scripts,
`dashboard/` (Go TUI), `plugins/`, the 20 language `modes/` dirs.

## UI: shadcn/ui

`components.json` is configured (`new-york`, `baseColor: neutral`, cssVariables),
so `npx shadcn@latest add <component>` drops in and inherits the theme with no
edits. Components are **owned** in `web/src/components/ui/` — edit them freely;
that is the shadcn model, not a fork smell.

Tokens are shadcn-canonical (`primary`, `card`, `muted-foreground`, `accent`,
`destructive`, …) in `web/src/app/globals.css`. Upstream's warm burnt-orange /
cream palette was replaced by shadcn's neutral oklch set; re-theming later means
editing the `:root` / `.dark` blocks only, not component classNames.

**Not converted, on purpose:** raw `<button className=...>` elements across ~34
files. They are already accessible native buttons, so swapping them for
`<Button>` is cosmetic churn with real regression risk (their bespoke classNames
fight `buttonVariants`), and many sit in views slated for deletion (the
local-CLI routes). Convert opportunistically as you touch a file.

Radix conversions so far: `status-select`, `log-dialog` (Dialog — focus trap,
scroll lock, Escape and aria-modal now come from the primitive rather than a
hand-rolled overlay + `window` keydown listener), `apply-view`'s dynamic form
fields.

## Build order

0. **Mirror the ATS company datasets.** `scan-ats-full.mjs:84` fetches them from
   `raw.githubusercontent.com/Feashliaa/job-board-aggregator` (greenhouse 8,333 ·
   lever 4,368 · ashby 3,161 · workday 12,884 companies), cached 24h in
   `data/cache/ats-companies`. That is a product dependency on a third party's
   unversioned repo — mirror the four JSON files into our own storage and refresh
   on our own schedule before shipping.
1. **Discovery spine** — Postgres schema; orchestrator over `providers/`; dedup on `url-key`; cron sweep; seed boards from `templates/portals.example.yml`. Ship search behind the existing `/explore` UI.
2. **Document spine** — CV payload editor (the `ENTRY_FIELD_SPECS.html` shape) → `buildCvHtml` → `renderHtmlToPdf` → object storage → `verifyAts` score shown back.
3. **The join (the actual product)** — one LLM call: `job.description` + `cv_payload` → *reordered/reworded* payload + cover letter. Diff view before render. Only place a model belongs in the MVP.

## Carry these upstream invariants forward

- **Never auto-submit.** Prefill and draft; a human presses the button.
- **No fabrication.** Reorder/reframe/emphasise, never invent. Quantified claims trace to a user-authored source. See upstream `AGENTS.md` "Source-of-Truth Boundary" — the story-bank provenance-drift problem is real and the failure mode (inventing a metric onto someone's CV) is lawsuit-grade.
- **Job postings are untrusted input.** Data, never instructions.
- **Keep the `<<cv-html>>` envelope.** The model emits HTML inline; the *backend* writes it. The CV that renders is the one the backend parsed, never a file an agent wrote. See `web/README.md` "Safety".
- **Keep `providers/_ip-guard.mjs` and `_safe-url.mjs`.** We fetch URLs server-side; that's SSRF surface.
- **Assert the `Job` shape** at our boundary. An upstream shape change won't break the merge — it breaks the orchestrator silently.

## Attribution

MIT, © 2026 Santiago Fernández de Valderrama. `LICENSE` retained.
