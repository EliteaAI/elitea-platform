#!/usr/bin/env node
/**
 * check-fixture-freshness.mjs — R-M4 enforcement (spec §6.5, unit M1).
 *
 * R-M4: "Fixtures older than 30 days fail CI." (FIXTURE_MAX_AGE_DAYS in
 * scripts/lib/mock-rules-core.mjs, unit F2.)
 *
 * Walks every `src/test/msw/fixtures/**\/*.json` file, parses it, and runs
 * it through `checkFixtureFreshness` with the REAL current time — a fixture
 * whose `recordedAt` is missing, unparseable, or more than
 * FIXTURE_MAX_AGE_DAYS days in the past fails the build. This includes
 * fixtures marked `"synthetic": true` (transport/artifacts/upload/download,
 * units F4/S6): R-M4 is about staleness of the RECORDING METADATA, not
 * about whether the fixture happens to describe a real backend response —
 * a synthetic fixture still carries a `recordedAt` its own module doc
 * commits to keeping current, and scripts/record-fixtures.mjs (unit M1) is
 * how a real-backend-recordable one gets re-stamped.
 *
 * Usage: node scripts/check-fixture-freshness.mjs [--root <dir>] [--now <ISO-8601>]
 *   --now is a test/CI-debugging seam only; production runs use the real
 *   current time (no flag).
 *
 * RED/GREEN (see the M1 report for the transcript): temporarily overwrite
 * any fixture's `recordedAt` with a date > 30 days in the past — this
 * script exits 1, naming the file and its age; restore the original byte
 * content — this script exits 0 again.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

import { FIXTURE_MAX_AGE_DAYS, checkFixtureFreshness } from './lib/mock-rules-core.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(SCRIPT_DIR, '..');

function parseArgs(argv) {
  const args = { root: APP_DIR, now: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') {
      const value = argv[i + 1];
      if (!value) throw new Error('--root requires a directory argument');
      args.root = resolve(value);
      i++;
    } else if (argv[i] === '--now') {
      const value = argv[i + 1];
      if (!value) throw new Error('--now requires an ISO-8601 date argument');
      args.now = value;
      i++;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function* jsonFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* jsonFiles(full);
    } else if (entry.endsWith('.json')) {
      yield full;
    }
  }
}

function main() {
  const { root, now } = parseArgs(process.argv.slice(2));
  const fixturesDir = join(root, 'src', 'test', 'msw', 'fixtures');
  const nowDate = now ? new Date(now) : new Date();
  if (Number.isNaN(nowDate.getTime())) {
    console.error(`check-fixture-freshness: --now value is not a parseable date: ${now}`);
    process.exit(2);
  }

  let files = 0;
  const findings = [];

  for (const file of jsonFiles(fixturesDir)) {
    files++;
    const rel = relative(root, file);
    let fixture;
    try {
      fixture = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      findings.push({ rule: 'R-M4', file: rel, line: 1, message: `not valid JSON: ${err.message}` });
      continue;
    }
    findings.push(...checkFixtureFreshness(rel, fixture, nowDate));
  }

  if (files === 0) {
    console.error(`check-fixture-freshness: found 0 fixtures under ${relative(root, fixturesDir)} — refusing to pass vacuously`);
    process.exit(2);
  }

  for (const f of findings) {
    console.error(`${f.rule} ${f.file} — ${f.message}`);
  }
  if (findings.length > 0) {
    console.error(`check-fixture-freshness: ${findings.length} stale/invalid fixture(s) of ${files} — failing (R-M4, max ${FIXTURE_MAX_AGE_DAYS} days)`);
    process.exit(1);
  }
  console.log(`check-fixture-freshness: OK — ${files} fixture(s) under src/test/msw/fixtures/ are within the freshness window (R-M4)`);
}

main();
