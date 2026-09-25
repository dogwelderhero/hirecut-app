import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

/**
 * Milestone 2 evidence: ownership, containment and the code/data root split.
 *
 * The brief requires proof that "two anonymous sessions cannot read, edit,
 * download, cancel, activate or inspect each other's runs, including by
 * swapping run/job/artifact/browser IDs", that "parent environment is
 * unchanged", and that "concurrent children receive distinct data roots".
 *
 * These are exercised at the module boundary rather than over HTTP: the route
 * handlers all resolve ownership through `ownsRun` / `ownedRun` and paths
 * through `containedPath`, so pinning those is what makes every route safe,
 * including ones written later.
 */

let sandbox;
before(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), "hirecute-test-"));
  process.env.HIRECUTE_DATA_DIR = sandbox;
  process.env.HIRECUTE_CODE_ROOT = path.resolve(process.cwd(), "..");
});
after(async () => {
  await rm(sandbox, { recursive: true, force: true });
  delete process.env.HIRECUTE_DATA_DIR;
  delete process.env.HIRECUTE_CODE_ROOT;
});

const paths = await import("../../src/lib/hirecute/paths.ts");
// The pure predicate, not session.ts — that imports next/headers, which
// only resolves inside the Next runtime.
const { ownsRun } = await import("../../src/lib/hirecute/ownership.ts");
const store = await import("../../src/lib/hirecute/store.ts");
const { deniedInPublicBuild, isPublicBuild } = await import(
  "../../src/lib/hirecute/public-boundary.ts"
);

const sessionA = { id: "a".repeat(64), createdAt: "", currentRunId: null, ownedRunIds: [], stripeCustomerId: null };
const sessionB = { id: "b".repeat(64), createdAt: "", currentRunId: null, ownedRunIds: [], stripeCustomerId: null };

// ── Ownership ──────────────────────────────────────────────────────────────

test("a run ID is an identifier, not permission: session B does not own A's run", () => {
  const runA = paths.newRunId();
  const a = { ...sessionA, ownedRunIds: [runA], currentRunId: runA };
  assert.equal(ownsRun(a, runA), true);
  assert.equal(ownsRun(sessionB, runA), false, "B must not own a run it merely knows the ID of");
  assert.equal(ownsRun(null, runA), false, "no cookie owns nothing");
});

test("ownership covers previously owned runs, so old downloads still work", () => {
  const older = paths.newRunId();
  const current = paths.newRunId();
  const a = { ...sessionA, ownedRunIds: [older, current], currentRunId: current };
  assert.equal(ownsRun(a, older), true, "an artifact from a finished run is still theirs");
  assert.equal(ownsRun(a, paths.newRunId()), false, "a freshly guessed ID is not");
});

// ── Path containment ──────────────────────────────────────────────────────

test("path traversal out of a run directory is refused", () => {
  const runId = paths.newRunId();
  for (const attempt of [
    "../../etc/passwd",
    "..",
    "output/../../../secret",
    "/etc/passwd",
    "output/../../" + "x".repeat(10),
  ]) {
    assert.equal(paths.containedPath(runId, attempt), null, `must refuse ${attempt}`);
  }
});

test("a legitimate relative path inside the run resolves", () => {
  const runId = paths.newRunId();
  const resolved = paths.containedPath(runId, "output/base-resume.pdf");
  assert.ok(resolved);
  assert.ok(resolved.startsWith(paths.runDir(runId) + path.sep));
});

test("one run's directory cannot be reached from another's base", () => {
  const runA = paths.newRunId();
  const runB = paths.newRunId();
  // Walking up and across is the shape an artifact-ID swap would take.
  const escape = path.join("..", runB, "run.json");
  assert.equal(paths.containedPath(runA, escape), null);
});

test("a malformed run or session id is rejected before touching the filesystem", () => {
  for (const bad of ["../../etc", "not-a-uuid", "", "x".repeat(200)]) {
    assert.throws(() => paths.runDir(bad), /malformed run id/);
  }
  assert.throws(() => paths.sessionFile("nope"), /malformed session id/);
});

// ── codeRoot / dataRoot split ─────────────────────────────────────────────

test("concurrent children receive DISTINCT data roots", () => {
  const runA = paths.newRunId();
  const runB = paths.newRunId();
  const envA = paths.childEnv(runA);
  const envB = paths.childEnv(runB);

  assert.notEqual(envA.CAREER_OPS_ROOT, envB.CAREER_OPS_ROOT);
  assert.notEqual(envA.CAREER_OPS_TRACKER, envB.CAREER_OPS_TRACKER);
  assert.ok(envA.CAREER_OPS_ROOT.endsWith(runA));
  assert.ok(envB.CAREER_OPS_ROOT.endsWith(runB));
});

test("the tracker override is explicit and run-owned", () => {
  // Not redundant: generate-pdf.mjs resolves its workspace root separately, and
  // its tracker-cache refresh can otherwise fall back to the code checkout.
  const runId = paths.newRunId();
  const env = paths.childEnv(runId);
  assert.equal(env.CAREER_OPS_TRACKER, path.join(paths.runDir(runId), "data", "applications.md"));
  assert.ok(
    !env.CAREER_OPS_TRACKER.startsWith(paths.codeRoot() + path.sep + "data"),
    "the tracker must never resolve into the immutable checkout",
  );
});

test("the parent process.env is never mutated by building a child env", () => {
  const before = JSON.stringify(process.env);
  paths.childEnv(paths.newRunId());
  paths.childEnv(paths.newRunId());
  assert.equal(JSON.stringify(process.env), before, "childEnv must be pure");
  assert.equal(process.env.CAREER_OPS_ROOT, undefined);
  assert.equal(process.env.HIRECUTE_RUN_ID, undefined);
});

test("the child env is an allowlist: parent secrets do not leak to a worker", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_should_not_leak";
  process.env.HIRECUTE_MODEL_API_KEY = "model_should_not_leak";
  process.env.SOME_UNRELATED_SECRET = "nope";
  try {
    const env = paths.childEnv(paths.newRunId());
    assert.equal(env.STRIPE_SECRET_KEY, undefined, "a renderer needs no Stripe key");
    assert.equal(env.HIRECUTE_MODEL_API_KEY, undefined);
    assert.equal(env.SOME_UNRELATED_SECRET, undefined);
    assert.ok(env.PATH, "but PATH is kept, or nothing can execute");
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.HIRECUTE_MODEL_API_KEY;
    delete process.env.SOME_UNRELATED_SECRET;
  }
});

test("only allowlisted scripts can be located, and always under codeRoot", () => {
  const p = paths.scriptPath("generate-pdf.mjs");
  assert.ok(p.startsWith(paths.codeRoot() + path.sep));
  assert.throws(() => paths.scriptPath("rm"), /not allowlisted/);
  assert.throws(() => paths.scriptPath("../../bin/sh"), /not allowlisted/);
});

// ── Run bootstrap ─────────────────────────────────────────────────────────

test("a new run gets a valid EMPTY tracker and no seeded candidate", async () => {
  const runId = paths.newRunId();
  await paths.bootstrapRunDir(runId);
  const tracker = await readFile(paths.paths.tracker(runId), "utf8");
  assert.match(tracker, /^# Applications/);
  assert.match(tracker, /\| # \| Date \| Company \|/, "the header must be present and valid");
  const rows = tracker.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.equal(rows.length, 0, "no seeded applications, ever");
  assert.equal(await paths.exists(path.join(paths.runDir(runId), "originals")), true);
  assert.equal(await paths.exists(path.join(paths.runDir(runId), "private")), true);
});

// ── Event log: sequence, replay, and private diagnostics ─────────────────

async function seedRun(ownerSessionId) {
  const runId = paths.newRunId();
  await paths.bootstrapRunDir(runId);
  await store.writeSnapshot(runId, {
    snapshot: {
      schemaVersion: 1,
      id: runId,
      origin: "sample",
      launchProfile: "activation_pilot",
      status: "running",
      currentStage: "refine",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSequence: 0,
      journeyVersion: 1,
      profile: null,
      preferences: { targetRoles: [], locations: [], workStyles: [], origin: "suggested_from_resume", version: 1 },
      stages: {
        refine: { stage: "refine", status: "running", inputVersion: 1, inputHash: "", attempt: 1, actions: [], result: null, error: null },
        explore: { stage: "explore", status: "pending", inputVersion: 1, inputHash: "", attempt: 0, actions: [], result: null, error: null },
        match: { stage: "match", status: "pending", inputVersion: 1, inputHash: "", attempt: 0, actions: [], result: null, error: null },
        prepare: { stage: "prepare", status: "pending", inputVersion: 1, inputHash: "", attempt: 0, actions: [], result: null, error: null },
      },
      evidence: [], jobs: [], assessments: [], applications: [],
      selection: { jobIds: [], version: 1, updatedAt: new Date().toISOString() },
      artifacts: [],
      billing: { status: "not_started", mode: "test", promotionalCredit: null, entitlement: null, amountChargedMinor: 0, error: null },
    },
    ownerSessionId,
    billingRecordId: null,
    artifacts: {},
  });
  return runId;
}

test("sequence numbers are monotonic and the snapshot advances with the log", async () => {
  const runId = await seedRun(sessionA.id);
  const first = await store.appendEvent(runId, "action.completed", { stage: "refine", actionId: "a1" }, "refine");
  const second = await store.appendEvent(runId, "action.completed", { stage: "refine", actionId: "a2" }, "refine");
  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  const file = await store.readRunFile(runId);
  assert.equal(file.snapshot.lastSequence, 2, "lastSequence cannot disagree with the log");
});

test("concurrent appends do not lose or reuse a sequence number", async () => {
  const runId = await seedRun(sessionA.id);
  // 20 appends fired without awaiting, which is what two worker messages
  // arriving in the same tick look like.
  const events = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.appendEvent(runId, "action.completed", { stage: "refine", actionId: `a${i}` }, "refine"),
    ),
  );
  const seqs = events.map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1), "no gaps, no duplicates");
  const onDisk = await store.readEventsAfter(runId, 0);
  assert.equal(onDisk.length, 20);
});

test("a reconnect cursor replays exactly the missing events", async () => {
  const runId = await seedRun(sessionA.id);
  for (let i = 0; i < 5; i += 1) {
    await store.appendEvent(runId, "action.completed", { stage: "refine", actionId: `a${i}` }, "refine");
  }
  const afterAll = await store.readEventsAfter(runId, 5);
  assert.deepEqual(afterAll, [], "a caught-up client gets nothing, not a replay");

  const missing = await store.readEventsAfter(runId, 2);
  assert.deepEqual(
    missing.map((e) => e.seq),
    [3, 4, 5],
    "only events after the cursor, so no receipt is duplicated",
  );
});

test("a truncated final log line does not break a reconnecting client", async () => {
  const runId = await seedRun(sessionA.id);
  await store.appendEvent(runId, "action.completed", { stage: "refine", actionId: "a1" }, "refine");
  // A partially flushed append is a normal race, not a reason to drop a client.
  await writeFile(paths.paths.events(runId), (await readFile(paths.paths.events(runId), "utf8")) + '{"version":1,"seq":2,', "utf8");
  const events = await store.readEventsAfter(runId, 0);
  assert.equal(events.length, 1, "the good line survives, the partial one is skipped");
});

test("private diagnostics live outside the public event log", async () => {
  const runId = await seedRun(sessionA.id);
  await store.appendDiagnostic(runId, { stderr: "a model prompt and a stack trace" });
  await store.appendEvent(runId, "action.completed", { stage: "refine", actionId: "a1" }, "refine");

  const publicEvents = await store.readEventsAfter(runId, 0);
  const serialized = JSON.stringify(publicEvents);
  assert.doesNotMatch(serialized, /stack trace/, "diagnostics must not reach the stream");
  assert.doesNotMatch(serialized, /model prompt/);

  const diagnostics = await readFile(paths.paths.diagnostics(runId), "utf8");
  assert.match(diagnostics, /stack trace/, "they are kept for the operator, elsewhere");
  // And in a different file, under private/.
  assert.notEqual(paths.paths.diagnostics(runId), paths.paths.events(runId));
  assert.match(paths.paths.diagnostics(runId), /[/\\]private[/\\]/);
});

test("the run file records its owner, so a swapped ID fails the second check", async () => {
  const runA = await seedRun(sessionA.id);
  const file = await store.readRunFile(runA);
  assert.equal(file.ownerSessionId, sessionA.id);
  assert.notEqual(file.ownerSessionId, sessionB.id, "B cannot pass the owner check on A's run");
});

// ── Public build boundary ────────────────────────────────────────────────

test("a public build denies the legacy API and allows only /api/hirecute/*", () => {
  const env = { HIRECUTE_PUBLIC_BUILD: "true", NODE_ENV: "production" };
  for (const legacy of [
    "/api/run",
    "/api/assistant",
    "/api/memory",
    "/api/clis",
    "/api/cv/ingest",
    "/api/apply/session",
    "/api/apply/drive",
    "/api/portals",
    "/api/doctor",
    // A route that does not exist yet must also be denied, not defaulted open.
    "/api/some-future-upstream-route",
  ]) {
    assert.equal(deniedInPublicBuild(legacy, env), true, `${legacy} must be denied`);
  }
  for (const ours of [
    "/api/hirecute/runs",
    "/api/hirecute/runs/current/events",
    "/api/hirecute/artifacts/abc",
    "/api/hirecute/billing/webhook",
  ]) {
    assert.equal(deniedInPublicBuild(ours, env), false, `${ours} must be reachable`);
  }
});

test("a near-miss prefix cannot slip past the allowlist", () => {
  const env = { HIRECUTE_PUBLIC_BUILD: "true", NODE_ENV: "production" };
  assert.equal(deniedInPublicBuild("/api/hirecute", env), true, "no trailing slash is not the namespace");
  assert.equal(deniedInPublicBuild("/api/hirecute-legacy/runs", env), true);
  assert.equal(deniedInPublicBuild("/api/nothirecute/runs", env), true);
});

test("non-API paths are never denied by this gate", () => {
  const env = { HIRECUTE_PUBLIC_BUILD: "true", NODE_ENV: "production" };
  for (const p of ["/", "/pipeline", "/home", "/_next/static/x.js"]) {
    assert.equal(deniedInPublicBuild(p, env), false);
  }
});

test("the gate defaults closed in production and open in development", () => {
  assert.equal(isPublicBuild({ NODE_ENV: "production" }), true, "production defaults to closed legacy API");
  assert.equal(isPublicBuild({ NODE_ENV: "development" }), false);
  // An explicit flag always wins.
  assert.equal(isPublicBuild({ NODE_ENV: "development", HIRECUTE_PUBLIC_BUILD: "true" }), true);
  assert.equal(isPublicBuild({ NODE_ENV: "production", HIRECUTE_PUBLIC_BUILD: "false" }), false);
});
