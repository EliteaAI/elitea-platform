/**
 * User-visible name tables for weekday/month values, routed through the real
 * `t()` shim (`@/shared/i18n`) per N3/R-T3 — every label resolves against
 * `src/shared/i18n/en.json`, falling back to the English text at the call
 * site when a key is absent.
 */
import { t } from '@/shared/i18n';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_SHORT_FALLBACKS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_FULL_FALLBACKS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;
const MONTH_SHORT_FALLBACKS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;
const MONTH_FULL_FALLBACKS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Every i18n key this module can emit, paired with the exact English text
 * the matching `t()` call site passes as its fallback.
 *
 * DEFECT this table records. The four label functions below build their keys
 * with a template literal. `scripts/i18n-backfill.mjs` classifies a template
 * literal as a `dynamic-key`, prints it, and never fails the gate, so all 38
 * keys were absent from `src/shared/i18n/en.json`. Each render of a weekday
 * or a month button therefore logged `[shared/i18n] missing key ...` through
 * `warnOnMissingKey`, in production as well as in development. The labels
 * could never be localised. The keys are registered now. This table
 * makes the set declarable, so the next reader can see it without expanding
 * a template literal in their head.
 *
 * A bundle value BEATS a call-site fallback. Keep the text in `en.json`
 * character-for-character the same as the `fallback` here.
 */
export interface CronLabelI18nEntry {
  readonly key: string;
  readonly fallback: string;
}

function buildEntries(
  group: string,
  keys: readonly string[],
  fallbacks: readonly string[],
): readonly CronLabelI18nEntry[] {
  return keys.map((key, index) => ({
    key: `shared.ui.cron.${group}.${key}`,
    fallback: fallbacks[index] ?? '',
  }));
}

/** @public The declared key set — read by `__tests__/labels.test.ts`. */
export const CRON_LABEL_I18N_ENTRIES: readonly CronLabelI18nEntry[] = [
  ...buildEntries('weekdayShort', WEEKDAY_KEYS, WEEKDAY_SHORT_FALLBACKS),
  ...buildEntries('weekdayFull', WEEKDAY_KEYS, WEEKDAY_FULL_FALLBACKS),
  ...buildEntries('monthShort', MONTH_KEYS, MONTH_SHORT_FALLBACKS),
  ...buildEntries('monthFull', MONTH_KEYS, MONTH_FULL_FALLBACKS),
];

function at<T>(arr: readonly T[], index: number, fallback: T): T {
  return arr[index] ?? fallback;
}

/** `n` is the canonical 0-6 (Sunday=0) weekday domain used by `CronFieldState`. */
export function weekdayShortLabel(n: number): string {
  const key = at(WEEKDAY_KEYS, n, 'sun');
  return t(`shared.ui.cron.weekdayShort.${key}`, at(WEEKDAY_SHORT_FALLBACKS, n, 'Sun'));
}

export function weekdayFullLabel(n: number): string {
  const key = at(WEEKDAY_KEYS, n, 'sun');
  return t(`shared.ui.cron.weekdayFull.${key}`, at(WEEKDAY_FULL_FALLBACKS, n, 'Sunday'));
}

/** `n` is the cron 1-12 month domain. */
export function monthShortLabel(n: number): string {
  const idx = n - 1;
  const key = at(MONTH_KEYS, idx, 'jan');
  return t(`shared.ui.cron.monthShort.${key}`, at(MONTH_SHORT_FALLBACKS, idx, 'Jan'));
}

export function monthFullLabel(n: number): string {
  const idx = n - 1;
  const key = at(MONTH_KEYS, idx, 'jan');
  return t(`shared.ui.cron.monthFull.${key}`, at(MONTH_FULL_FALLBACKS, idx, 'January'));
}
