#!/usr/bin/env node
/**
 * hirecute preflight — see src/lib/hirecute/preflight.mjs for what is checked.
 *
 *   node scripts/preflight.mjs --boot            # before `next start` (the image runs this)
 *   node scripts/preflight.mjs --full            # before a deploy: + boards, Chromium render
 *   node scripts/preflight.mjs --full --url https://…   # + smoke test of a deployed app
 *   node --env-file=.env.local scripts/preflight.mjs --full   # local, with an env file
 *
 * Flags: --json (machine-readable). Exit code 1 if any check FAILs.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { formatReport, runPreflight } from "../src/lib/hirecute/preflight.mjs";

const args = process.argv.slice(2);
const mode = args.includes("--full") ? "full" : "boot";
const urlIdx = args.indexOf("--url");
const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;

// Resolved from this file, not from cwd: web/scripts/ → repo root.
const here = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = process.env.HIRECUTE_CODE_ROOT?.trim() || path.resolve(here, "..", "..");
const dataDir = process.env.HIRECUTE_DATA_DIR?.trim() || path.join(codeRoot, "var", "hirecute");

const started = Date.now();
const report = await runPreflight({ mode, env: process.env, codeRoot, dataDir, url });

if (args.includes("--json")) {
  process.stdout.write(JSON.stringify({ mode, ms: Date.now() - started, ...report }, null, 2) + "\n");
} else {
  process.stdout.write(formatReport(report, { mode }) + ` in ${Date.now() - started} ms\n`);
}
// exitCode, not exit(): exiting while fetch sockets are still closing trips a
// libuv assertion on Windows.
process.exitCode = report.ok ? 0 : 1;
