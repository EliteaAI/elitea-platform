#!/usr/bin/env node
/**
 * check-dead-code.mjs — the knip gate, with a floor (issue #528).
 *
 * ci-web.yml's gate-dead-code job ran `npx knip --max-issues 0`. knip reports
 * the files and exports nothing reaches. Zero files give zero issues, so the
 * job passed whether knip analysed 3965 files or none of them.
 *
 * knip's own report holds no total to read, so the count comes from the
 * subject knip is pointed at: the `project` globs in knip.json. If those match
 * nothing — a renamed `src`, a changed extension, a glob that lost its `**` —
 * knip analyses nothing and says nothing, and this script says so instead.
 *
 * The `entry` globs are counted too, for a different failure. Entry files are
 * the roots of knip's reachability graph. Lose them and knip does not go
 * quiet: it reports the whole tree as unreachable, which is loud. The count is
 * printed because a reader deciding whether to trust the tick needs both
 * numbers, not because it is the quiet direction.
 *
 * Run: node scripts/check-dead-code.mjs
 */
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { checkFloors } from './lib/gate-floor.mjs';
import { stripJsonc } from './lib/jsonc.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KNIP_CONFIG = join(APP_DIR, 'knip.json');

/*
 * Measured on 2026-08-28: 3967 files match the `project` globs (3885 under
 * src/, 66 under scripts/, 16 under tools/lint-rules/), and 566 match the
 * `entry` globs.
 *
 * `entry` carries a long tail of single files pinned ahead of a consumer, so
 * its count moves in both directions as those consumers land. Its floor sits
 * well under today's number for that reason.
 */
const MIN_PROJECT_FILES = 2500;
const MIN_ENTRY_FILES = 200;

let config;
try {
  config = JSON.parse(stripJsonc(readFileSync(KNIP_CONFIG, 'utf8')));
} catch (err) {
  console.error(`check-dead-code: cannot read/parse ${KNIP_CONFIG}: ${err.message}`);
  process.exit(2);
}

/** Count the distinct files a list of globs matches, relative to the app. */
function countMatches(globs) {
  const found = new Set();
  for (const pattern of globs ?? []) {
    for (const file of globSync(pattern, { cwd: APP_DIR })) found.add(file);
  }
  return found.size;
}

const floors = checkFloors('check-dead-code', [
  { subject: 'files matched by knip.json `project`', observed: countMatches(config.project), floor: MIN_PROJECT_FILES },
  { subject: 'files matched by knip.json `entry`', observed: countMatches(config.entry), floor: MIN_ENTRY_FILES },
]);
for (const line of floors.lines) console.log(line);
if (!floors.ok) {
  console.error(floors.error);
  process.exit(2);
}

// knip owns the verdict. `--max-issues 0` is the gate the job has always run;
// this script only refuses to let it run over an empty subject set.
const knip = spawnSync(join(APP_DIR, 'node_modules', '.bin', 'knip'), ['--max-issues', '0'], {
  cwd: APP_DIR,
  stdio: 'inherit',
});

if (knip.status !== 0) {
  console.error(`check-dead-code: FAIL — knip exited ${knip.status}. Delete the dead code, or state the exception in knip.json.`);
  process.exit(knip.status ?? 1);
}

console.log('check-dead-code: OK');
