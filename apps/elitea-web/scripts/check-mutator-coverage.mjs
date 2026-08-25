#!/usr/bin/env node
/**
 * check-mutator-coverage.mjs — the coverage floor on the hand-written
 * `eliteaFetch` adapter, src/shared/api/generated/mutator.ts (issue #421).
 *
 * Run: node scripts/check-mutator-coverage.mjs [--coverage <coverage-final.json>]
 *
 * It reads the MERGED coverage artifact the `coverage-merge` job uploads, so
 * it needs no vitest run of its own. The rules live in
 * scripts/lib/mutator-coverage-core.mjs, where the `scripts` vitest project
 * proves each one RED and GREEN; this file only gathers the facts.
 *
 * The per-file counts come from istanbul-lib-coverage rather than from a
 * hand-rolled walk of the `s`/`f`/`b` maps. The previous inline version of
 * this gate branched on whether those maps were arrays or objects, derived
 * "lines" from the statement map, and then divided the statement total by
 * itself. istanbul owns that arithmetic and gets all four metrics right.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import coveragePkg from 'istanbul-lib-coverage';

import {
  COVERAGE_METRICS,
  MUTATOR_COVERAGE_TARGET,
  MUTATOR_COVERAGE_THRESHOLDS,
  checkMutatorCoverage,
  formatMutatorCoverage,
} from './lib/mutator-coverage-core.mjs';

const { createCoverageMap } = coveragePkg;

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flagIndex = args.indexOf('--coverage');
const coveragePath = path.resolve(
  appRoot,
  flagIndex === -1 ? 'coverage/coverage-final.json' : (args[flagIndex + 1] ?? ''),
);

if (!existsSync(coveragePath)) {
  console.error(`check-mutator-coverage: FAIL — no coverage report at ${coveragePath}`);
  const dir = path.dirname(coveragePath);
  if (existsSync(dir)) console.error(`  ${dir} holds: ${readdirSync(dir).join(', ') || '(empty)'}`);
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(coveragePath, 'utf8'));
} catch (error) {
  console.error(`check-mutator-coverage: FAIL — ${coveragePath} is not readable JSON: ${error.message}`);
  process.exit(1);
}

const map = createCoverageMap(raw);
const files = {};
for (const key of map.files()) {
  const summary = map.fileCoverageFor(key).toSummary();
  const data = typeof summary.toJSON === 'function' ? summary.toJSON() : summary;
  files[key] = Object.fromEntries(
    COVERAGE_METRICS.map((metric) => [
      metric,
      { covered: data[metric]?.covered ?? 0, total: data[metric]?.total ?? 0 },
    ]),
  );
}

const result = checkMutatorCoverage({ files });

// Printed on every run, pass or fail: a gate that measured nothing must not
// produce the same log as a gate that measured everything.
console.log(
  `check-mutator-coverage: ${map.files().length} file(s) in ${path.relative(appRoot, coveragePath)}; `
    + formatMutatorCoverage(result),
);
console.log(
  '  floors — '
    + COVERAGE_METRICS.map((metric) => `${metric} ${MUTATOR_COVERAGE_THRESHOLDS[metric]}%`).join(', '),
);

if (!result.ok) {
  for (const failure of result.failures) console.error(`check-mutator-coverage: FAIL — ${failure}`);
  process.exit(1);
}

console.log(`check-mutator-coverage: OK — ${MUTATOR_COVERAGE_TARGET} meets every floor`);
