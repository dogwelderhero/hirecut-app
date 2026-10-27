/**
 * Preflight: is this deployment able to serve a run at all?
 *
 * Two modes, one list of checks:
 *   boot  Runs before `next start` in the image. Config, files, disk, and one
 *         live model request (retried; only a definitive provider answer fails
 *         the boot). A failure stops the container with the reason in the
 *         deploy log, so App Platform keeps the previous version serving.
 *   full  Before a deploy, or against a live URL. Everything in boot, plus
 *         a real job-board fetch, a real Chromium render, and a smoke test of
 *         a deployed app.
 *
 * Every result names what is wrong AND what to do about it; a check that cannot
 * decide says so (WARN) instead of guessing a verdict.
 */

import { execFile } from "node:child_process";
import { constants as fsc } from "node:fs";
import { access, mkdir, readdir, rm, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isLoopbackHost, parseAllowedHosts } from "../origin-guard.mjs";
import { modelEndpoints, pingModel } from "./model.mjs";

export const OK = "OK";
export const WARN = "WARN";
export const FAIL = "FAIL";

const r = (group, name, status, detail = "", fix = "") => ({ group, name, status, detail, fix });

/** Files the worker and the PDF chain run at request time (paths.ts SCRIPT_ALLOWLIST + inputs). */
export const REQUIRED_CODE_FILES = [
  "build-cv-html.mjs",
  "generate-pdf.mjs",
  "verify-cv-facts.mjs",
  "verify-ats.mjs",
  "fetch-jd.mjs",
  "scan.mjs",
  "lib/cv-payload-schema.mjs",
  "templates/cv-template.html",
  "providers",
  "web/workers/hirecute-runner.mjs",
  "web/fixtures/sample-resume.pdf",
];

const PLACEHOLDER = /^(REPLACE_IN_DASHBOARD|REPLACE_ME|your[_-]|changeme|xxx+$)|_REPLACE_ME$/i;

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// ── Configuration (no I/O) ────────────────────────────────────────────────────

/** @param {Record<string, string|undefined>} env */
export function checkEnv(env) {
  const out = [];
  const production = env.NODE_ENV === "production";

  // Model endpoint
  const base = env.HIRECUTE_MODEL_API_BASE_URL?.trim();
  const baseUrl = base ? parseUrl(base) : null;
  if (!base) out.push(r("config", "model base URL", FAIL, "HIRECUTE_MODEL_API_BASE_URL is not set", "Set it, e.g. https://api.anthropic.com/v1"));
  else if (!baseUrl) out.push(r("config", "model base URL", FAIL, `not a URL: ${base}`, "Use an absolute https URL"));
  else out.push(r("config", "model base URL", OK, baseUrl.origin));

  const key = env.HIRECUTE_MODEL_API_KEY?.trim();
  if (!key) out.push(r("config", "model key", FAIL, "HIRECUTE_MODEL_API_KEY is not set", "Set the secret in App Platform: Settings → web → Environment Variables"));
  else if (key.startsWith("EV[")) {
    out.push(r("config", "model key", FAIL, "the key reached the container still encrypted (EV[...])",
      "An EV[] value only decrypts inside the app that encrypted it. The app was recreated or the spec copied from another app: re-enter the key in the dashboard"));
  } else if (PLACEHOLDER.test(key)) out.push(r("config", "model key", FAIL, "the key is a placeholder", "Replace it with the real secret"));
  else out.push(r("config", "model key", OK, `set (${key.length} chars)`));

  if (!env.HIRECUTE_MODEL?.trim()) out.push(r("config", "model name", FAIL, "HIRECUTE_MODEL is not set", "Set the model id, e.g. claude-sonnet-5"));
  else {
    const tiers = ["HIRECUTE_MODEL_FAST", "HIRECUTE_MODEL_JUDGMENT"].filter((k) => env[k]?.trim()).map((k) => `${k}=${env[k]}`);
    out.push(r("config", "model name", OK, [env.HIRECUTE_MODEL, ...tiers].join(", ")));
  }

  // Public URL + host guard
  const pub = env.HIRECUTE_BASE_URL?.trim();
  const pubUrl = pub ? parseUrl(pub) : null;
  if (!pub) {
    out.push(r("config", "public URL", production ? FAIL : WARN, "HIRECUTE_BASE_URL is not set (defaults to http://localhost:3100)",
      "Set it to the app's public URL; on App Platform bind ${APP_URL}"));
  } else if (!pubUrl) {
    out.push(r("config", "public URL", FAIL, `not a URL: ${pub}`, "Use the absolute public URL"));
  } else {
    out.push(r("config", "public URL", OK, pubUrl.origin));
    const host = [...parseAllowedHosts(pubUrl.host)][0];
    const allowed = parseAllowedHosts(env.CAREER_OPS_WEB_ALLOWED_HOSTS);
    if (isLoopbackHost(pubUrl.hostname)) {
      out.push(r("config", "allowed hosts", OK, "public URL is loopback (always allowed)"));
    } else if (host && allowed.has(host)) {
      out.push(r("config", "allowed hosts", OK, `${host} is allowed`));
    } else {
      out.push(r("config", "allowed hosts", FAIL,
        `${pubUrl.host} is not in CAREER_OPS_WEB_ALLOWED_HOSTS (${[...allowed].join(", ") || "empty"}): every /api call would be refused`,
        "Add the public host; on App Platform bind ${APP_DOMAIN}"));
    }
  }

  // Submission: there is no tested adapter, so enabling it would promise
  // something the product cannot do.
  if (/^(1|true|yes)$/i.test(env.HIRECUTE_SUBMISSION_ENABLED ?? "")) {
    out.push(r("config", "submission", FAIL, "HIRECUTE_SUBMISSION_ENABLED is true but no submit adapter exists", "Set it to false"));
  } else out.push(r("config", "submission", OK, "disabled"));

  // Stripe: all or nothing, and one mode.
  const sk = env.STRIPE_SECRET_KEY?.trim();
  const pk = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  const wh = env.STRIPE_WEBHOOK_SECRET?.trim();
  const set = [sk, pk, wh].filter(Boolean).length;
  if (set === 0) out.push(r("config", "stripe", OK, "not configured (billing off)"));
  else if (set < 3) {
    out.push(r("config", "stripe", FAIL, "only some Stripe variables are set",
      "Set all of STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, or none"));
  } else {
    const mode = (k, a, b) => (k.startsWith(a) ? "test" : k.startsWith(b) ? "live" : null);
    const skMode = mode(sk, "sk_test_", "sk_live_") ?? mode(sk, "rk_test_", "rk_live_");
    const pkMode = mode(pk, "pk_test_", "pk_live_");
    if (!skMode || !pkMode || !wh.startsWith("whsec_")) {
      out.push(r("config", "stripe", FAIL, "a Stripe value does not look like a Stripe key", "Check the sk_/pk_/whsec_ prefixes"));
    } else if (skMode !== pkMode) {
      out.push(r("config", "stripe", FAIL, `secret key is ${skMode}, publishable key is ${pkMode}`, "Use keys from the same mode"));
    } else out.push(r("config", "stripe", OK, `${skMode} mode`));
  }

  return out;
}

// ── Files, disk, runtime ──────────────────────────────────────────────────────

export async function checkFiles({ codeRoot, dataDir, minFreeBytes = 512 * 1024 * 1024 }) {
  const out = [];

  const missing = [];
  for (const rel of REQUIRED_CODE_FILES) {
    try {
      await access(path.join(codeRoot, rel), fsc.R_OK);
    } catch {
      missing.push(rel);
    }
  }
  out.push(missing.length
    ? r("files", "code root", FAIL, `missing under ${codeRoot}: ${missing.join(", ")}`,
      "The image or checkout is incomplete; check HIRECUTE_CODE_ROOT and web/Dockerfile.dockerignore")
    : r("files", "code root", OK, `${REQUIRED_CODE_FILES.length} required files present`));

  const probe = path.join(dataDir, `.preflight-${process.pid}-${Date.now()}`);
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(probe, "ok");
    await rm(probe);
    out.push(r("files", "data dir writable", OK, dataDir));
    try {
      const s = await statfs(dataDir);
      const free = s.bavail * s.bsize;
      const mb = Math.round(free / 1024 / 1024);
      out.push(free < minFreeBytes
        ? r("files", "data dir free space", WARN, `${mb} MB free`, "Runs, PDFs and sessions are written here")
        : r("files", "data dir free space", OK, `${mb} MB free`));
    } catch {
      out.push(r("files", "data dir free space", WARN, "could not read free space"));
    }
  } catch (err) {
    out.push(r("files", "data dir writable", FAIL, `${dataDir}: ${err.code ?? err.message}`,
      "Set HIRECUTE_DATA_DIR to a writable directory owned by the app user"));
  }

  const [major, minor] = process.versions.node.split(".").map(Number);
  out.push(major > 22 || (major === 22 && minor >= 6)
    ? r("runtime", "node", OK, process.versions.node)
    : r("runtime", "node", FAIL, `${process.versions.node} < 22.6`, "web/ needs --experimental-strip-types support"));

  out.push(await checkChromiumInstalled());
  return out;
}

/** Playwright's default browser cache for the current user and platform. */
export function playwrightCacheDir(env = process.env, platform = process.platform) {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

/**
 * Presence only (boot). The image installs Playwright's headless shell at its
 * default per-user cache; `full` proves it can actually render.
 */
export async function checkChromiumInstalled(cacheDir = playwrightCacheDir()) {
  try {
    const entries = await readdir(cacheDir);
    const shell = entries.find((e) => /^chromium(_headless_shell)?-\d+/.test(e));
    if (shell) return r("runtime", "chromium", OK, shell);
  } catch {
    /* fall through */
  }
  // WARN for now: PDF rendering is off in the current flow. It becomes FAIL
  // once an enabled scenario needs it (the classic package step).
  return r("runtime", "chromium", WARN, `no Playwright Chromium under ${cacheDir}`,
    "PDF rendering will fail; the image installs it with `playwright install --only-shell chromium`");
}

// ── Live: model ───────────────────────────────────────────────────────────────

const MODEL_FIX = {
  key: "The key is invalid, revoked, or lacks access: issue a new one and update HIRECUTE_MODEL_API_KEY",
  model: "The provider does not know this model id: fix HIRECUTE_MODEL (or the tier override)",
  billing: "The provider account cannot pay for calls: top up or switch the key",
  rejected: "The provider refused the request: read the detail",
  unreachable: "Nothing proven either way after retries: provider or network trouble. Re-run preflight --full later",
};

export async function checkModel(env, pingOpts = {}) {
  let endpoints;
  try {
    endpoints = modelEndpoints(env);
  } catch {
    return [r("live", "model", FAIL, "model endpoint not configured", "See the config checks above")];
  }
  const out = [];
  for (const ep of endpoints) {
    const name = `model ${ep.model} (${ep.tiers.join("+")})`;
    const res = await pingModel(ep, pingOpts);
    if (res.ok) {
      out.push(r("live", name, OK, `answered in ${res.latencyMs} ms${res.attempts > 1 ? ` after ${res.attempts} attempts` : ""}`));
    } else {
      const status = res.kind === "unreachable" ? WARN : FAIL;
      const detail = `${res.kind}: ${res.status ?? "no response"} ${res.detail}`.trim() + ` (${res.attempts} attempt${res.attempts > 1 ? "s" : ""})`;
      out.push(r("live", name, status, detail, MODEL_FIX[res.kind]));
    }
  }
  return out;
}

// ── Live: job boards, Chromium, deployed app (full only) ─────────────────────

export async function checkBoards({ codeRoot }) {
  try {
    const { enabledBoards } = await import("./boards.mjs");
    const { fetchBoards } = await import("./upstream.mjs");
    const board = enabledBoards()[0];
    if (!board) return r("live", "job boards", FAIL, "no enabled boards", "Check boards.mjs");
    const started = Date.now();
    const { raw, coverage } = await fetchBoards({ codeRoot, boards: [board], deadlineMs: 15_000, perBoardMs: 12_000 });
    const ms = Date.now() - started;
    if (raw.length) return r("live", "job boards", OK, `${board.name}: ${raw.length} postings in ${ms} ms`);
    return r("live", "job boards", WARN, `${board.name}: no postings (${coverage.warnings.join("; ") || coverage.status})`,
      "Explore will find nothing if every board answers like this");
  } catch (err) {
    return r("live", "job boards", FAIL, err instanceof Error ? err.message : String(err), "Explore cannot fetch postings");
  }
}

export async function checkChromiumRender({ codeRoot, dataDir }) {
  // Inside the data dir and with CAREER_OPS_ROOT set to it, exactly as the
  // worker renders: generate-pdf.mjs refuses to write outside its workspace.
  const dir = path.join(dataDir, `.preflight-render-${process.pid}-${Date.now()}`);
  try {
    await mkdir(dir, { recursive: true });
    const html = path.join(dir, "probe.html");
    const pdf = path.join(dir, "probe.pdf");
    await writeFile(html, "<!doctype html><title>preflight</title><p>preflight</p>");
    const started = Date.now();
    const result = await new Promise((resolve) =>
      execFile(process.execPath, [path.join(codeRoot, "generate-pdf.mjs"), html, pdf, "--format=a4"],
        { cwd: codeRoot, timeout: 60_000, env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: dir } }, (err, stdout, stderr) => resolve({ err, stderr: String(stderr) })));
    if (result.err) {
      return r("live", "chromium render", FAIL, result.stderr.slice(0, 300) || result.err.message,
        "generate-pdf.mjs could not launch Chromium; PDF packages will fail");
    }
    await access(pdf, fsc.R_OK);
    return r("live", "chromium render", OK, `PDF rendered in ${Date.now() - started} ms`);
  } catch (err) {
    return r("live", "chromium render", FAIL, err instanceof Error ? err.message : String(err));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function checkDeployment(url, { fetchImpl = fetch } = {}) {
  const out = [];
  const base = parseUrl(url);
  if (!base) return [r("deploy", "url", FAIL, `not a URL: ${url}`)];
  for (const [name, p, expect] of [["health", "/health", (b) => b.trim() === "ok"], ["landing", "/", () => true]]) {
    try {
      const res = await fetchImpl(new URL(p, base), { signal: AbortSignal.timeout(15_000), redirect: "manual" });
      const body = await res.text();
      out.push(res.status === 200 && expect(body)
        ? r("deploy", name, OK, `${res.status} ${new URL(p, base).href}`)
        : r("deploy", name, FAIL, `${res.status} ${body.slice(0, 120)}`, "The deployed app is not serving this path"));
    } catch (err) {
      out.push(r("deploy", name, FAIL, err instanceof Error ? err.message : String(err), "The deployed app did not answer"));
    }
  }
  return out;
}

// ── Orchestration and report ─────────────────────────────────────────────────

/**
 * @param {{mode: "boot"|"full", env: Record<string,string|undefined>, codeRoot: string, dataDir: string, url?: string, pingOpts?: object}} opts
 */
export async function runPreflight({ mode, env, codeRoot, dataDir, url, pingOpts }) {
  const results = [...checkEnv(env), ...(await checkFiles({ codeRoot, dataDir }))];
  const configOk = !results.some((x) => x.group === "config" && x.name.startsWith("model") && x.status === FAIL);
  results.push(...(configOk
    ? await checkModel(env, pingOpts)
    : [r("live", "model", FAIL, "skipped: model configuration is invalid")]));
  if (mode === "full") {
    results.push(await checkBoards({ codeRoot }));
    results.push(await checkChromiumRender({ codeRoot, dataDir }));
    if (url) results.push(...(await checkDeployment(url)));
  }
  return { ok: !results.some((x) => x.status === FAIL), results };
}

export function formatReport({ ok, results }, { mode }) {
  const w = Math.max(...results.map((x) => `${x.group} / ${x.name}`.length));
  const lines = [`hirecute preflight (${mode})`];
  for (const x of results) {
    lines.push(`  ${x.status.padEnd(4)}  ${`${x.group} / ${x.name}`.padEnd(w)}  ${x.detail}`);
    if (x.status !== OK && x.fix) lines.push(`        ${" ".repeat(w)}  → ${x.fix}`);
  }
  const fails = results.filter((x) => x.status === FAIL).length;
  const warns = results.filter((x) => x.status === WARN).length;
  lines.push(ok ? `PASS (${warns} warning${warns === 1 ? "" : "s"})` : `FAIL: ${fails} check${fails === 1 ? "" : "s"} failed, ${warns} warning${warns === 1 ? "" : "s"}`);
  return lines.join("\n");
}
