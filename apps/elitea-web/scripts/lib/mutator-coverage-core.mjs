/**
 * mutator-coverage-core.mjs — the rule logic behind
 * scripts/check-mutator-coverage.mjs (issue #421).
 *
 * The gate used to be an inline `node -e` program in ci-web.yml's
 * `gate-mutator-coverage` job. Three defects rode along with that shape, and
 * all three are one kind: the gate could not report a failure.
 *
 *   1. The statement percentage was `pct(totalStmts, totalStmts)` — a count
 *      divided by itself. It read 100 on every run, so the `if (sp < 90)` test
 *      below it was dead code. The job claimed four thresholds and applied
 *      three.
 *
 *   2. A zero statement count printed "mutator.ts not in coverage (excluded
 *      per config) — skipping" and exited 0. The count was ALWAYS zero:
 *      vitest.config.ts excluded `src/shared/api/generated/**` from coverage
 *      and mutator.ts sits in that directory. The gate had never measured
 *      anything. `mutator.ts` is hand-written, not orval output, so the
 *      exclusion is now scoped to the generated subdirectories and this rule
 *      refuses the empty case instead of passing on it.
 *
 *   3. The file filter also accepted `mutator.test.ts`. A test file scores
 *      near 100% because running it is what covers it, so part of the number
 *      the gate printed was the test measuring itself.
 *
 * The rules live here, away from the filesystem, so the `scripts` vitest
 * project can prove each of them RED and GREEN. ci-web.yml's "Gate-script
 * decision-logic coverage" job holds every file in this directory at 100%.
 */

/** The one hand-written module in the generated tree. */
export const MUTATOR_COVERAGE_TARGET = 'src/shared/api/generated/mutator.ts';

/**
 * The floors ci-web.yml declared before this file existed, kept unchanged.
 * mutator.test.ts's own header states the same contract: "carries the ≥90%
 * infra floor the S4 task sets for this file".
 */
export const MUTATOR_COVERAGE_THRESHOLDS = Object.freeze({
  lines: 90,
  statements: 90,
  functions: 90,
  branches: 85,
});

/** The metrics a report must supply, in the order the gate prints them. */
export const COVERAGE_METRICS = Object.freeze(['lines', 'statements', 'functions', 'branches']);

/** A test file is not the module under test. */
export function isTestPath(filePath) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

/**
 * True when a coverage key names the target module.
 *
 * Coverage reports carry absolute keys, so the match is on the path suffix.
 * The suffix must start at a directory boundary, and a test file is rejected
 * first: `mutator.test.ts` does not end with `/mutator.ts`, but the previous
 * gate matched with `String.prototype.includes` and accepted it.
 */
export function matchesTarget(coverageKey, target = MUTATOR_COVERAGE_TARGET) {
  const normalised = String(coverageKey).split('\\').join('/');
  if (isTestPath(normalised)) return false;
  return normalised === target || normalised.endsWith(`/${target}`);
}

/** covered/total as a percentage. Callers must reject a zero total first. */
export function percentage(covered, total) {
  return (covered / total) * 100;
}

/**
 * The gate's decision.
 *
 * @param {object} input
 * @param {Record<string, Record<string, {covered: number, total: number}>>} input.files
 *   coverage key → metric → counts, as istanbul's per-file summary reports them.
 * @param {string} [input.target]
 * @param {Record<string, number>} [input.thresholds]
 * @returns {{ok: boolean, matched: string[], percentages: Record<string, number>, failures: string[]}}
 */
export function checkMutatorCoverage({
  files,
  target = MUTATOR_COVERAGE_TARGET,
  thresholds = MUTATOR_COVERAGE_THRESHOLDS,
}) {
  const matched = Object.keys(files ?? {}).filter((key) => matchesTarget(key, target));
  const failures = [];
  const percentages = {};

  if (matched.length === 0) {
    // The rule that replaces `process.exit(0)`. An absent target means the
    // coverage configuration, the orval output path or the merge step moved,
    // and a gate with nothing to read must say so rather than report a pass.
    failures.push(
      `${target} is not in the coverage report. Either coverage no longer measures it, or the file `
        + 'moved. The gate would be vacuous, so it fails instead of skipping.',
    );
    return { ok: false, matched, percentages, failures };
  }

  if (matched.length > 1) {
    // Two keys for one module means the report merged runs from different
    // roots. Averaging them would silently halve the real percentages.
    failures.push(`${target} matched ${matched.length} coverage entries (${matched.join(', ')}); expected exactly one.`);
    return { ok: false, matched, percentages, failures };
  }

  const metrics = files[matched[0]];

  for (const metric of COVERAGE_METRICS) {
    const counts = metrics?.[metric];
    const total = counts?.total ?? 0;
    const covered = counts?.covered ?? 0;

    if (total === 0) {
      // A metric with nothing to count is the same vacuum as a missing file.
      // The old `pct()` returned 100 for a zero total, which turned every such
      // metric into a pass.
      failures.push(`${metric}: no data (0 of 0 counted) — a metric with nothing to measure cannot be a pass.`);
      continue;
    }

    const pct = percentage(covered, total);
    percentages[metric] = pct;
    const floor = thresholds[metric];
    if (floor != null && pct < floor) {
      failures.push(`${metric}: ${pct.toFixed(2)}% (${covered}/${total}) is below the ${floor}% floor.`);
    }
  }

  return { ok: failures.length === 0, matched, percentages, failures };
}

/** One line per metric, so a run that measured nothing does not look like a run that measured everything. */
export function formatMutatorCoverage(result, target = MUTATOR_COVERAGE_TARGET) {
  if (result.matched.length !== 1) return `${target}: no single coverage entry`;
  const parts = COVERAGE_METRICS.map((metric) => {
    const pct = result.percentages[metric];
    return `${metric} ${pct === undefined ? 'n/a' : `${pct.toFixed(2)}%`}`;
  });
  return `${target} — ${parts.join(', ')}`;
}
