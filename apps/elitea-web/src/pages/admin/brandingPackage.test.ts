/**
 * The branding package's presentation helpers (ADR-0024 WP9): the refusal
 * reader, the diff cell formatter, and the small formatters the versions
 * table is made of.
 */
import { describe, expect, it } from 'vitest';

import {
  formatDiffValue,
  formatPackageSize,
  formatPackageTime,
  isInheritValue,
  parseBrandingPackageReport,
  reportSummary,
  shortDigest,
} from './brandingPackage';

describe('parseBrandingPackageReport', () => {
  it('reads a refusal body that carries the report shape', () => {
    const report = parseBrandingPackageReport({
      ok: false,
      dry_run: true,
      applied: false,
      problems: [{ entry: 'brand-pack.json', reason: 'schema: brand.hue must be a hex colour' }],
      warnings: ['preview/app.html omitted'],
      diff: [],
      manifest: { format: 1, exported_at: '2026-09-01T10:00:00Z', product: 'Acme', pack_digest: 'abc', generator: 'elitea' },
    });
    expect(report?.ok).toBe(false);
    expect(report?.problems).toHaveLength(1);
    expect(report?.warnings).toEqual(['preview/app.html omitted']);
    expect(report?.manifest?.product).toBe('Acme');
    expect(report?.version).toBeUndefined();
  });

  it('defaults the optional lists and reads flags strictly', () => {
    const report = parseBrandingPackageReport({ ok: false, problems: [], dry_run: 'yes' });
    expect(report).toEqual({ ok: false, dry_run: false, applied: false, problems: [], warnings: [], diff: [] });
  });

  it('answers nothing for an {error} envelope or a non-object', () => {
    expect(parseBrandingPackageReport({ error: 'the upload must be a multipart form under 4 MiB' })).toBeUndefined();
    expect(parseBrandingPackageReport('nope')).toBeUndefined();
    expect(parseBrandingPackageReport(null)).toBeUndefined();
  });
});

describe('isInheritValue', () => {
  it('treats empty, zero, [] and {} as inherit and everything else as set', () => {
    expect(isInheritValue(undefined)).toBe(true);
    expect(isInheritValue(null)).toBe(true);
    expect(isInheritValue('')).toBe(true);
    expect(isInheritValue('  ')).toBe(true);
    expect(isInheritValue(0)).toBe(true);
    expect(isInheritValue([])).toBe(true);
    expect(isInheritValue({})).toBe(true);
    expect(isInheritValue('Acme')).toBe(false);
    expect(isInheritValue(15)).toBe(false);
    expect(isInheritValue(false)).toBe(false);
    expect(isInheritValue([{ family: 'Inter' }])).toBe(false);
  });
});

describe('formatDiffValue', () => {
  it('shows scalars as themselves and inherit values as the label', () => {
    expect(formatDiffValue('Acme', 'inherit')).toBe('Acme');
    expect(formatDiffValue(15, 'inherit')).toBe('15');
    expect(formatDiffValue(true, 'inherit')).toBe('true');
    expect(formatDiffValue('', 'inherit')).toBe('inherit');
    expect(formatDiffValue(0, 'inherit')).toBe('inherit');
    expect(formatDiffValue([], 'inherit')).toBe('inherit');
  });

  it('shows arrays and objects as compact JSON', () => {
    expect(formatDiffValue([{ family: 'Inter', url: '/f.woff2' }], 'inherit')).toBe('[{"family":"Inter","url":"/f.woff2"}]');
    expect(formatDiffValue({ light: { primary: 'x' } }, 'inherit')).toBe('{"light":{"primary":"x"}}');
  });

  it('cuts a long value with an ellipsis at 80 characters', () => {
    const long = 'x'.repeat(200);
    const shown = formatDiffValue(long, 'inherit');
    expect(shown).toHaveLength(80);
    expect(shown.endsWith('…')).toBe(true);
  });
});

describe('shortDigest / formatPackageSize / formatPackageTime', () => {
  it('shortens a digest to twelve characters and leaves a short one alone', () => {
    expect(shortDigest('0123456789abcdef0123456789abcdef')).toBe('0123456789ab');
    expect(shortDigest('abc')).toBe('abc');
  });

  it('formats sizes in B, KiB and MiB', () => {
    expect(formatPackageSize(80)).toBe('80 B');
    expect(formatPackageSize(1536)).toBe('1.5 KiB');
    expect(formatPackageSize(3 * 1024 * 1024)).toBe('3.0 MiB');
    expect(formatPackageSize(-1)).toBe('—');
    expect(formatPackageSize(Number.NaN)).toBe('—');
  });

  it('formats a parseable timestamp, echoes an unparseable one, and dashes an absent one', () => {
    expect(formatPackageTime(undefined)).toBe('—');
    expect(formatPackageTime('')).toBe('—');
    expect(formatPackageTime('not a date')).toBe('not a date');
    const shown = formatPackageTime('2026-09-01T10:00:00Z');
    expect(shown).not.toBe('—');
    expect(shown).toContain('2026');
  });
});

describe('reportSummary', () => {
  it('prefers the report error, then the first problem, then nothing', () => {
    const base = { ok: false, dry_run: false, applied: false, warnings: [], diff: [] };
    expect(reportSummary({ ...base, problems: [], error: 'refused' })).toBe('refused');
    expect(reportSummary({ ...base, problems: [{ entry: 'assets/logo.svg', reason: 'scripts' }] })).toBe('assets/logo.svg: scripts');
    expect(reportSummary({ ...base, problems: [] })).toBeUndefined();
  });
});
