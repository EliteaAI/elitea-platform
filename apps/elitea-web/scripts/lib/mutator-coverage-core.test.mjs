import { describe, expect, it } from 'vitest';

import {
  COVERAGE_METRICS,
  MUTATOR_COVERAGE_TARGET,
  MUTATOR_COVERAGE_THRESHOLDS,
  checkMutatorCoverage,
  formatMutatorCoverage,
  isTestPath,
  matchesTarget,
  percentage,
} from './mutator-coverage-core.mjs';

// Each case below is one of issue #421's defects reduced to its smallest form,
// plus the neighbouring case that must NOT fire. A rule with only positive
// cases is satisfied by answering "offence" to everything; a rule with only
// negative cases is the dormant gate again.

const ABS = `/home/runner/work/elitea-platform/apps/elitea-web/${MUTATOR_COVERAGE_TARGET}`;

/** A full metric set at the given percentage, with `total` counts that are real. */
function metricsAt(pct) {
  const total = 100;
  const covered = Math.round((pct / 100) * total);
  return Object.fromEntries(COVERAGE_METRICS.map((metric) => [metric, { covered, total }]));
}

describe('matchesTarget', () => {
  it('accepts the absolute key a coverage report writes', () => {
    expect(matchesTarget(ABS)).toBe(true);
  });

  it('accepts a report already relative to the app root', () => {
    expect(matchesTarget(MUTATOR_COVERAGE_TARGET)).toBe(true);
  });

  it('accepts a Windows-separated key', () => {
    expect(matchesTarget('C:\\work\\apps\\elitea-web\\src\\shared\\api\\generated\\mutator.ts')).toBe(true);
  });

  it('REJECTS mutator.test.ts — defect 3: the old filter used `includes` and counted the test file', () => {
    expect(matchesTarget(ABS.replace('mutator.ts', 'mutator.test.ts'))).toBe(false);
  });

  it('rejects a spec file and a .tsx test beside the target', () => {
    expect(isTestPath('src/shared/api/generated/mutator.spec.ts')).toBe(true);
    expect(isTestPath('src/shared/api/generated/hook-envelope.test.tsx')).toBe(true);
    expect(isTestPath(MUTATOR_COVERAGE_TARGET)).toBe(false);
  });

  it('requires the suffix to start at a directory boundary', () => {
    // `vendor-src/...` ends with the target string but not with `/` + target,
    // so it is a different file and must not answer for the real one.
    expect(matchesTarget('/elsewhere/vendor-src/shared/api/generated/mutator.ts')).toBe(false);
    expect(matchesTarget('/elsewhere/notmutator.ts', 'mutator.ts')).toBe(false);
  });

  it('rejects an unrelated module', () => {
    expect(matchesTarget('/repo/apps/elitea-web/src/shared/api/http.ts')).toBe(false);
  });
});

describe('percentage', () => {
  it('divides covered by total — defect 1 was `pct(total, total)`, which is always 100', () => {
    expect(percentage(45, 90)).toBe(50);
    expect(percentage(90, 90)).toBe(100);
    expect(percentage(0, 90)).toBe(0);
  });
});

describe('checkMutatorCoverage — defect 2: a missing target must fail, not skip', () => {
  it('fails when the report holds no entry for the target', () => {
    const result = checkMutatorCoverage({ files: { '/repo/src/shared/api/http.ts': metricsAt(100) } });
    expect(result.ok).toBe(false);
    expect(result.matched).toEqual([]);
    expect(result.failures.join(' ')).toContain('is not in the coverage report');
  });

  it('fails on an empty report rather than reporting a pass', () => {
    expect(checkMutatorCoverage({ files: {} }).ok).toBe(false);
  });

  it('fails when `files` is absent altogether', () => {
    expect(checkMutatorCoverage({}).ok).toBe(false);
  });

  it('fails when the test file is the only entry — the old gate scored that as a pass', () => {
    const result = checkMutatorCoverage({
      files: { [ABS.replace('mutator.ts', 'mutator.test.ts')]: metricsAt(100) },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('is not in the coverage report');
  });

  it('fails when one module produced two coverage entries', () => {
    const result = checkMutatorCoverage({
      files: { [ABS]: metricsAt(100), [`/other/root/${MUTATOR_COVERAGE_TARGET}`]: metricsAt(100) },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('matched 2 coverage entries');
  });
});

describe('checkMutatorCoverage — thresholds', () => {
  it('passes when every metric is above its floor', () => {
    const result = checkMutatorCoverage({ files: { [ABS]: metricsAt(96) } });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.percentages.statements).toBe(96);
  });

  it('fails on statements alone — the metric the old gate could not test', () => {
    const files = { [ABS]: { ...metricsAt(100), statements: { covered: 80, total: 100 } } };
    const result = checkMutatorCoverage({ files });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['statements: 80.00% (80/100) is below the 90% floor.']);
  });

  it('fails on each of the other three metrics on its own', () => {
    for (const metric of ['lines', 'functions', 'branches']) {
      const files = { [ABS]: { ...metricsAt(100), [metric]: { covered: 50, total: 100 } } };
      const result = checkMutatorCoverage({ files });
      expect(result.ok).toBe(false);
      expect(result.failures.join(' ')).toContain(`${metric}: 50.00%`);
    }
  });

  it('holds branches to 85 and the rest to 90', () => {
    expect(MUTATOR_COVERAGE_THRESHOLDS).toEqual({ lines: 90, statements: 90, functions: 90, branches: 85 });
    const files = { [ABS]: { ...metricsAt(100), branches: { covered: 86, total: 100 } } };
    expect(checkMutatorCoverage({ files }).ok).toBe(true);
  });

  it('fails a metric with a zero total — the old pct() answered 100 for that case', () => {
    const files = { [ABS]: { ...metricsAt(100), functions: { covered: 0, total: 0 } } };
    const result = checkMutatorCoverage({ files });
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('functions: no data (0 of 0 counted)');
    expect(result.percentages.functions).toBeUndefined();
  });

  it('fails a metric the report omits entirely', () => {
    const files = { [ABS]: { ...metricsAt(100), branches: undefined } };
    expect(checkMutatorCoverage({ files }).ok).toBe(false);
  });

  it('fails all four metrics when the entry itself carries no counts', () => {
    const result = checkMutatorCoverage({ files: { [ABS]: undefined } });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(COVERAGE_METRICS.length);
  });

  it('accepts a caller-supplied floor set, and applies none for a metric left out', () => {
    const files = { [ABS]: metricsAt(50) };
    const result = checkMutatorCoverage({ files, thresholds: { lines: 40 } });
    expect(result.ok).toBe(true);
    expect(result.percentages.branches).toBe(50);
  });

  it('accepts a caller-supplied target', () => {
    const files = { '/repo/src/shared/api/http.ts': metricsAt(99) };
    expect(checkMutatorCoverage({ files, target: 'src/shared/api/http.ts' }).ok).toBe(true);
  });
});

describe('formatMutatorCoverage', () => {
  it('prints every metric with its percentage', () => {
    const result = checkMutatorCoverage({ files: { [ABS]: metricsAt(96) } });
    expect(formatMutatorCoverage(result)).toBe(
      `${MUTATOR_COVERAGE_TARGET} — lines 96.00%, statements 96.00%, functions 96.00%, branches 96.00%`,
    );
  });

  it('prints n/a for a metric that had no data', () => {
    const files = { [ABS]: { ...metricsAt(96), branches: { covered: 0, total: 0 } } };
    expect(formatMutatorCoverage(checkMutatorCoverage({ files }))).toContain('branches n/a');
  });

  it('says so when no single entry matched', () => {
    expect(formatMutatorCoverage(checkMutatorCoverage({ files: {} }))).toBe(
      `${MUTATOR_COVERAGE_TARGET}: no single coverage entry`,
    );
    expect(formatMutatorCoverage(checkMutatorCoverage({ files: {} }), 'x.ts')).toBe('x.ts: no single coverage entry');
  });
});
