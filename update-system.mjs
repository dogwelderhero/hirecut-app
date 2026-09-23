#!/usr/bin/env node
/**
 * update-system.mjs — DISABLED IN THIS FORK.
 *
 * Upstream, this script rewrites ~315 "system layer" files in place from
 * career-ops-hq/career-ops. In hirecut those files are the product, so running
 * it would silently revert product changes.
 *
 * Pull upstream changes through git instead, which keeps the diff reviewable:
 *
 *   git checkout main && git pull upstream main    # main stays a pristine mirror
 *   git checkout product && git merge main         # conflicts surface here, on your terms
 *
 * The original implementation is in git history:
 *   git show upstream/main:update-system.mjs
 *
 * `check` reports "dismissed" so the agent update-check flow stays silent
 * rather than erroring (see AGENTS.md "Update Check").
 */

const cmd = process.argv[2] || 'check';

if (cmd === 'check') {
  console.log(JSON.stringify({
    status: 'dismissed',
    reason: 'fork: system updates are managed via git (see PRODUCT.md)',
  }));
  process.exit(0);
}

console.error(
  `update-system.mjs is disabled in the hirecut fork — "${cmd}" would overwrite product files.\n` +
  'Use git instead:\n' +
  '  git checkout main && git pull upstream main\n' +
  '  git checkout product && git merge main'
);
process.exit(1);
