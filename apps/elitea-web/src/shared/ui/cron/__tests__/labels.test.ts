import { describe, expect, it } from 'vitest';

import {
  CRON_LABEL_I18N_ENTRIES,
  monthFullLabel,
  monthShortLabel,
  weekdayFullLabel,
  weekdayShortLabel,
} from '../labels';

describe('weekday labels (canonical domain: 0=Sunday .. 6=Saturday)', () => {
  it('returns the short and full names for every in-domain value', () => {
    expect(weekdayShortLabel(0)).toBe('Sun');
    expect(weekdayFullLabel(0)).toBe('Sunday');
    expect(weekdayShortLabel(6)).toBe('Sat');
    expect(weekdayFullLabel(6)).toBe('Saturday');
    expect(weekdayFullLabel(3)).toBe('Wednesday');
  });

  it('falls back to Sunday for an out-of-domain index', () => {
    expect(weekdayShortLabel(-1)).toBe('Sun');
    expect(weekdayFullLabel(9)).toBe('Sunday');
  });
});

describe('month labels (cron domain: 1=January .. 12=December)', () => {
  it('returns the short and full names for every in-domain value', () => {
    expect(monthShortLabel(1)).toBe('Jan');
    expect(monthFullLabel(1)).toBe('January');
    expect(monthShortLabel(12)).toBe('Dec');
    expect(monthFullLabel(12)).toBe('December');
    expect(monthFullLabel(6)).toBe('June');
  });

  it('falls back to January for an out-of-domain index', () => {
    expect(monthShortLabel(0)).toBe('Jan');
    expect(monthFullLabel(13)).toBe('January');
  });
});

/**
 * DEFECT: the four label functions build their i18n keys with a template
 * literal (`shared.ui.cron.weekdayShort.${key}`). `scripts/i18n-backfill.mjs`
 * reports a template literal as a `dynamic-key` and never fails the gate, so
 * all 38 keys were missing from `src/shared/i18n/en.json`. Evidence: a
 * `console.warn` spy around `weekdayShortLabel(0)` recorded
 * `[shared/i18n] missing key "shared.ui.cron.weekdayShort.sun" ...`, and a
 * scan of `en.json` returned no key with any of the four prefixes.
 *
 * These cases pin the two halves the gate cannot see:
 *  - the declared key set matches the keys the functions really emit, so the
 *    table cannot drift away from the template literal;
 *  - `t()` returns the declared English text for every key. A bundle value
 *    BEATS a call-site fallback, so this fails if the text registered in
 *    `en.json` ever differs from the fallback beside it.
 */
describe('cron label i18n keys', () => {
  it('declares one entry per weekday and month key', () => {
    expect(CRON_LABEL_I18N_ENTRIES).toHaveLength(38);
    expect(new Set(CRON_LABEL_I18N_ENTRIES.map((entry) => entry.key)).size).toBe(38);
  });

  it('declares the exact key each label function emits, with its own English text', () => {
    const declared = new Map(CRON_LABEL_I18N_ENTRIES.map((entry) => [entry.key, entry.fallback]));

    const cases: readonly { readonly key: string; readonly actual: string }[] = [
      ...['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].flatMap((day, index) => [
        { key: `shared.ui.cron.weekdayShort.${day}`, actual: weekdayShortLabel(index) },
        { key: `shared.ui.cron.weekdayFull.${day}`, actual: weekdayFullLabel(index) },
      ]),
      ...['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].flatMap(
        (month, index) => [
          { key: `shared.ui.cron.monthShort.${month}`, actual: monthShortLabel(index + 1) },
          { key: `shared.ui.cron.monthFull.${month}`, actual: monthFullLabel(index + 1) },
        ],
      ),
    ];

    expect(cases).toHaveLength(38);
    for (const { key, actual } of cases) {
      expect(declared.get(key), `${key} must be declared`).toBeDefined();
      expect(actual, `${key} must render its declared text`).toBe(declared.get(key));
    }
  });
});
