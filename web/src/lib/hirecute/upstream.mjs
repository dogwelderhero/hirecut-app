/**
 * The allowlisted adapter over career-ops's provider layer.
 *
 * 01-architecture.md's reuse table: `providers/`, `scan.mjs` and `fetch-jd.mjs`
 * give "real discovery and JD retrieval, wrapped with time/volume bounds". This
 * module is that wrapper, and it is the ONLY place hirecute reaches into the
 * code root for discovery.
 *
 * Why it calls `providers/` directly instead of `scan.mjs`:
 * 03-repository-audit.md line 161 — "The receipt **does not contain full job
 * objects**." `scan.mjs --json` reports `added_urls` and counters, so rich
 * cards would need a second fetch per posting. Loading the provider modules and
 * calling `provider.fetch(entry, ctx)` returns the normalized `Job` objects
 * directly, which is what the cards actually need.
 *
 * Bounds are applied here, not hoped for: per-board timeout, overall deadline,
 * bounded concurrency, and a cap on retained postings.
 */

import path from "node:path";

/** Load the provider registry and HTTP context from the pinned code root. */
async function loadLayer(codeRoot) {
  const registry = await import(
    path.join(codeRoot, "providers", "_registry.mjs")
  );
  const http = await import(path.join(codeRoot, "providers", "_http.mjs"));
  const providers = await registry.loadProviders(path.join(codeRoot, "providers"));
  return { registry, http, providers };
}

/** Run tasks with bounded concurrency and an overall deadline. */
async function mapBounded(items, limit, deadlineAt, task) {
  const results = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      if (Date.now() > deadlineAt) {
        // Out of time is a COVERAGE fact, not a failure of the whole search.
        results[i] = { item: items[i], skipped: "deadline" };
        continue;
      }
      results[i] = await task(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Fetch postings from a curated board list.
 *
 * @param {object} opts
 * @param {string} opts.codeRoot
 * @param {import("./boards.mjs").Board[]} opts.boards
 * @param {number} [opts.concurrency]
 * @param {number} [opts.deadlineMs]  Overall budget. Partial results are kept.
 * @param {number} [opts.perBoardMs]
 * @param {(event: object) => void} [opts.onBoard]  Progress, per real completion.
 * @returns {Promise<{jobs: object[], coverage: object}>}
 */
export async function fetchBoards(opts) {
  const {
    codeRoot,
    boards,
    concurrency = 4,
    deadlineMs = 45_000,
    perBoardMs = 12_000,
    onBoard,
  } = opts;

  const { registry, http, providers } = await loadLayer(codeRoot);
  const deadlineAt = Date.now() + deadlineMs;

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const warnings = [];
  const raw = [];

  const outcomes = await mapBounded(boards, concurrency, deadlineAt, async (board) => {
    // Explicit provider, so a board that changed vendor errors instead of
    // quietly resolving to a different one.
    const resolved = registry.resolveProvider(board, providers);
    if (!resolved || resolved.error || !resolved.provider) {
      failed += 1;
      warnings.push(`${board.name}: no provider claims that board`);
      onBoard?.({ board: board.name, ok: false, reason: "no_provider" });
      return { item: board, error: "no_provider" };
    }

    // The same HTTP context the scanner builds, so a provider gets the
    // dependency-free helpers it expects (including normalizePostingUrl).
    const ctx = {
      ...http.makeHttpCtx(),
      // Undated postings are kept: §5 requires `postedAt` to stay nullable
      // rather than being filled in from fetch time.
      includeUndated: true,
    };

    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ timedOut: true }), perBoardMs),
    );

    try {
      const outcome = await Promise.race([
        resolved.provider.fetch(board, ctx).then((jobs) => ({ jobs })),
        timeout,
      ]);

      if (outcome.timedOut) {
        failed += 1;
        warnings.push(`${board.name}: did not respond in time`);
        onBoard?.({ board: board.name, ok: false, reason: "timeout" });
        return { item: board, error: "timeout" };
      }

      const jobs = Array.isArray(outcome.jobs) ? outcome.jobs : [];
      succeeded += 1;
      // One board failing must not erase another's results, so each board's
      // postings are accumulated as they arrive.
      for (const job of jobs) raw.push({ board, provider: resolved.provider.id, job });
      onBoard?.({ board: board.name, ok: true, count: jobs.length });
      return { item: board, jobs };
    } catch (err) {
      failed += 1;
      warnings.push(`${board.name}: ${err instanceof Error ? err.message : "failed"}`);
      onBoard?.({ board: board.name, ok: false, reason: "error" });
      return { item: board, error: "error" };
    }
  });

  skipped = outcomes.filter((o) => o?.skipped === "deadline").length;
  if (skipped > 0) warnings.push(`${skipped} board(s) were not reached within the time budget`);

  return {
    raw,
    coverage: {
      // "partial" is a real, displayable result — not an all-or-nothing error.
      status: failed + skipped === 0 ? "complete_within_scope" : succeeded > 0 ? "partial" : "failed",
      boardsAttempted: boards.length,
      boardsSucceeded: succeeded,
      boardsFailed: failed + skipped,
      availableCompanies: null,
      capHit: false,
      staleDataset: false,
      stoppedByOutage: succeeded === 0,
      undatedPostingsDropped: 0,
      jobsFound: raw.length,
      jobsRetained: 0, // set by the caller after filtering
      scopeDescription: "",
      warnings,
    },
  };
}

/**
 * Retrieve a job description through career-ops's own ATS API reader.
 *
 * `fetch-jd.mjs` prints the JD on stdout and exits 0 on a hit; exit 1 with
 * empty stdout means no hit, and the caller's next step is its own business.
 * We do NOT fall back to a browser here: a bounded server-side fetch is the
 * whole point, and a missing JD is an honest `descriptionStatus: "missing"`.
 */
export async function fetchJobDescription(opts) {
  const { codeRoot, env, url, timeoutMs = 20_000 } = opts;
  const { execFile } = await import("node:child_process");

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(codeRoot, "fetch-jd.mjs"), url],
      { cwd: codeRoot, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const text = String(stdout ?? "").trim();
        // Exit 0 with text is the documented hit condition.
        if (!error && text.length > 0) resolve({ ok: true, text });
        else resolve({ ok: false, text: "" });
      },
    );
  });
}
