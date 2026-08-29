#!/usr/bin/env node
/**
 * check-layer-cycle.mjs — the layer + cycle gate, with a floor (issue #528).
 *
 * ci-web.yml's gate-layer-cycle job ran `npx depcruise src --config
 * .dependency-cruiser.cjs` and read the exit code. That is a real check of
 * every module the cruise RESOLVES, and it says nothing about how many that
 * is. A cruise that resolves zero modules reports zero violations and exits 0:
 * rename `src`, break the tsconfig paths the resolver follows, or narrow
 * `doNotFollow`, and a green tick covers an empty run.
 *
 * The cruise already counts its own subject set. `summary.totalCruised` is in
 * the JSON report and nothing read it. This script reads it, states it, and
 * refuses a cruise that resolved implausibly little.
 *
 * READ THIS BEFORE CHANGING THE REPORTER. `depcruise --output-type json` exits
 * 0 EVEN WITH ERRORS — measured on the tools/lint-rules/fixtures/depcruise/bad
 * fixture, which reports 7 errors and exits 0. The `err` reporter the job used
 * to run exits with the error count instead. So the exit code of the child is
 * NOT the verdict here; `summary.error` is, and this script computes its own.
 *
 * Run: node scripts/check-layer-cycle.mjs
 */
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { checkFloors } from './lib/gate-floor.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'src';
const CONFIG = '.dependency-cruiser.cjs';

/*
 * Measured on 2026-08-28: 3164 modules cruised, 12067 dependencies.
 * The floor is a plausibility bar, not a target.
 */
const MIN_MODULES_CRUISED = 2000;

const cruise = spawnSync(
  join(APP_DIR, 'node_modules', '.bin', 'depcruise'),
  [SOURCE, '--config', CONFIG, '--output-type', 'json'],
  { cwd: APP_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

let report;
try {
  report = JSON.parse(cruise.stdout);
} catch {
  // A crash and a clean cruise must never look the same. Everything the child
  // said goes to the log.
  console.error(
    'check-layer-cycle: dependency-cruiser produced no JSON report, so nothing was cruised.\n' +
      `exit=${cruise.status}\n${cruise.stdout ?? ''}\n${cruise.stderr ?? ''}`,
  );
  process.exit(2);
}

const summary = report.summary ?? {};
const floors = checkFloors('check-layer-cycle', [
  { subject: `modules cruised under ${SOURCE}/`, observed: summary.totalCruised ?? 0, floor: MIN_MODULES_CRUISED },
]);
for (const line of floors.lines) console.log(line);
if (!floors.ok) {
  console.error(floors.error);
  process.exit(2);
}

const violations = summary.violations ?? [];
for (const v of violations) {
  console.log(`${v.rule.severity} ${v.rule.name}: ${v.from} -> ${v.to}`);
}

console.log(
  `check-layer-cycle: ${summary.totalDependenciesCruised} dependencies, ` +
    `${summary.error} error(s), ${summary.warn} warning(s), ${summary.info} info.`,
);

if (summary.error > 0) {
  console.error(
    `check-layer-cycle: FAIL — ${summary.error} rule violation(s) at severity error. ` +
      'Fix the import, or state the exception in .dependency-cruiser.cjs.',
  );
  process.exit(1);
}

console.log('check-layer-cycle: OK');
