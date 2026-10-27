import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FAIL,
  OK,
  REQUIRED_CODE_FILES,
  WARN,
  checkEnv,
  checkFiles,
  formatReport,
  playwrightCacheDir,
} from "../../src/lib/hirecute/preflight.mjs";
import { modelEndpoints, pingModel } from "../../src/lib/hirecute/model.mjs";

const GOOD = {
  NODE_ENV: "production",
  HIRECUTE_MODEL_API_BASE_URL: "https://api.anthropic.com/v1",
  HIRECUTE_MODEL_API_KEY: "sk-ant-api03-abcdefghijklmnop",
  HIRECUTE_MODEL: "claude-sonnet-5",
  HIRECUTE_BASE_URL: "https://hirecute-ic5vi.ondigitalocean.app",
  CAREER_OPS_WEB_ALLOWED_HOSTS: "hirecute-ic5vi.ondigitalocean.app",
  HIRECUTE_SUBMISSION_ENABLED: "false",
};

const byName = (results, name) => results.find((x) => x.name === name);

test("a complete production config passes every config check", () => {
  const results = checkEnv(GOOD);
  assert.deepEqual(results.filter((x) => x.status !== OK), []);
});

test("missing model settings each fail with a fix", () => {
  const results = checkEnv({ NODE_ENV: "production" });
  for (const name of ["model base URL", "model key", "model name", "public URL"]) {
    assert.equal(byName(results, name).status, FAIL, name);
    assert.ok(byName(results, name).fix, `${name} has a fix`);
  }
});

test("an EV[] key means the secret was not decrypted for this app", () => {
  const res = byName(checkEnv({ ...GOOD, HIRECUTE_MODEL_API_KEY: "EV[1:abc:def]" }), "model key");
  assert.equal(res.status, FAIL);
  assert.match(res.fix, /re-enter the key/);
});

test("placeholder keys are rejected", () => {
  for (const key of ["REPLACE_IN_DASHBOARD", "your_key_here", "pk_test_REPLACE_ME"]) {
    assert.equal(byName(checkEnv({ ...GOOD, HIRECUTE_MODEL_API_KEY: key }), "model key").status, FAIL, key);
  }
});

test("a public host missing from the allowed hosts fails: every /api call would be refused", () => {
  const res = byName(checkEnv({ ...GOOD, CAREER_OPS_WEB_ALLOWED_HOSTS: "other.example" }), "allowed hosts");
  assert.equal(res.status, FAIL);
  assert.match(res.detail, /every \/api call would be refused/);
  assert.equal(byName(checkEnv({ ...GOOD, CAREER_OPS_WEB_ALLOWED_HOSTS: "a.example, HIRECUTE-IC5VI.ondigitalocean.app" }), "allowed hosts").status, OK);
  assert.equal(byName(checkEnv({ ...GOOD, HIRECUTE_BASE_URL: "http://127.0.0.1:8080", CAREER_OPS_WEB_ALLOWED_HOSTS: "" }), "allowed hosts").status, OK);
});

test("an unset public URL is fatal in production only", () => {
  const { HIRECUTE_BASE_URL: _drop, ...rest } = GOOD;
  assert.equal(byName(checkEnv(rest), "public URL").status, FAIL);
  assert.equal(byName(checkEnv({ ...rest, NODE_ENV: "development" }), "public URL").status, WARN);
});

test("submission cannot be switched on without an adapter", () => {
  assert.equal(byName(checkEnv({ ...GOOD, HIRECUTE_SUBMISSION_ENABLED: "true" }), "submission").status, FAIL);
});

test("stripe is all-or-nothing and single-mode", () => {
  const stripe = { STRIPE_SECRET_KEY: "sk_test_1", NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" };
  assert.equal(byName(checkEnv({ ...GOOD, ...stripe }), "stripe").status, OK);
  assert.equal(byName(checkEnv({ ...GOOD, STRIPE_SECRET_KEY: "sk_test_1" }), "stripe").status, FAIL);
  assert.match(byName(checkEnv({ ...GOOD, ...stripe, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_1" }), "stripe").detail, /test.*live/);
});

test("model endpoints collapse tiers that resolve to the same model", () => {
  assert.deepEqual(modelEndpoints(GOOD).map((e) => [e.model, e.tiers]), [["claude-sonnet-5", ["fast", "judgment"]]]);
  const split = modelEndpoints({ ...GOOD, HIRECUTE_MODEL_FAST: "claude-haiku-5-5" });
  assert.deepEqual(split.map((e) => [e.model, e.tiers]), [["claude-haiku-5-5", ["fast"]], ["claude-sonnet-5", ["judgment"]]]);
});

// ── pingModel classification (scripted responses; the live path is exercised by `preflight --full`)

const endpoint = modelEndpoints(GOOD)[0];
function scripted(...responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body ?? "", { status: next.status });
  };
  return { calls, fetchImpl, sleep: async () => {} };
}

test("a 200 is a live key, and the request matches the stages' shape", async () => {
  const s = scripted({ status: 200, body: "{}" });
  const res = await pingModel(endpoint, s);
  assert.equal(res.ok, true);
  assert.equal(s.calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(s.calls[0].init.headers["anthropic-version"], "2023-06-01");
  assert.equal(JSON.parse(s.calls[0].init.body).model, "claude-sonnet-5");
});

test("401 is a dead key and is not retried", async () => {
  const s = scripted({ status: 401, body: "invalid x-api-key" });
  const res = await pingModel(endpoint, s);
  assert.deepEqual([res.ok, res.kind, res.attempts], [false, "key", 1]);
});

test("404 and model-named 400 are a wrong model; credit 400 is billing", async () => {
  assert.equal((await pingModel(endpoint, scripted({ status: 404 }))).kind, "model");
  assert.equal((await pingModel(endpoint, scripted({ status: 400, body: "model: x not found" }))).kind, "model");
  assert.equal((await pingModel(endpoint, scripted({ status: 400, body: "Your credit balance is too low" }))).kind, "billing");
  assert.equal((await pingModel(endpoint, scripted({ status: 422, body: "nope" }))).kind, "rejected");
});

test("transient failures are retried, and a later 200 still proves the key", async () => {
  const s = scripted({ status: 529 }, new Error("ECONNRESET"), { status: 200 });
  const res = await pingModel(endpoint, s);
  assert.deepEqual([res.ok, res.attempts], [true, 3]);
});

test("transient failures on every attempt prove nothing: unreachable, not a dead key", async () => {
  const s = scripted({ status: 503 }, { status: 429 }, { status: 500 }, new Error("ETIMEDOUT"));
  const res = await pingModel(endpoint, { ...s, attempts: 4 });
  assert.deepEqual([res.ok, res.kind, res.attempts], [false, "unreachable", 4]);
});

test("retries stop at the time budget", async () => {
  let t = 0;
  const s = scripted({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
  const res = await pingModel(endpoint, {
    ...s, attempts: 4, budgetMs: 2_500, backoffMs: 1_000, now: () => t, sleep: async (ms) => { t += ms; },
  });
  assert.equal(res.kind, "unreachable");
  assert.equal(res.attempts, 2); // 1st at 0, wait 1000, 2nd at 1000, next wait 2000 would cross 2500
});

// ── files

test("checkFiles reports exactly which required files are missing, and a writable data dir", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "preflight-root-"));
  try {
    for (const rel of REQUIRED_CODE_FILES.filter((f) => f !== "verify-ats.mjs")) {
      const p = path.join(root, rel);
      if (rel === "providers") await mkdir(p, { recursive: true });
      else {
        await mkdir(path.dirname(p), { recursive: true });
        await writeFile(p, "");
      }
    }
    const results = await checkFiles({ codeRoot: root, dataDir: path.join(root, "var", "hirecute") });
    const code = byName(results, "code root");
    assert.equal(code.status, FAIL);
    assert.match(code.detail, /verify-ats\.mjs$/);
    assert.equal(byName(results, "data dir writable").status, OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("playwright cache follows the platform and PLAYWRIGHT_BROWSERS_PATH", () => {
  assert.equal(playwrightCacheDir({ PLAYWRIGHT_BROWSERS_PATH: "/opt/pw" }, "linux"), "/opt/pw");
  assert.match(playwrightCacheDir({ LOCALAPPDATA: "C:\\L" }, "win32"), /ms-playwright$/);
  assert.match(playwrightCacheDir({}, "linux"), /\.cache[\\/]ms-playwright$/);
});

test("the report shows a fix under every non-OK line and a FAIL summary", () => {
  const text = formatReport(
    { ok: false, results: [{ group: "g", name: "a", status: OK, detail: "fine", fix: "" }, { group: "g", name: "b", status: FAIL, detail: "bad", fix: "do X" }] },
    { mode: "boot" },
  );
  assert.match(text, /FAIL\s+g \/ b\s+bad\n\s+→ do X/);
  assert.match(text, /FAIL: 1 check failed/);
});
