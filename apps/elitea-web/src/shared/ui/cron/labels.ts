/**
 * User-visible name tables for weekday/month values, routed through the
 * interim `t()` shim (`shared/ui/lib/t.ts`) per N3/R-T3: unit S8 has not
 * landed the real `i18next` wiring, so — same convention `shared/brand`
 * used for its own copy — every label already flows through `t(key,
 * fallback)` today, so swapping the shim body for `useTranslation()` later
 * touches one file, not every call site.
 */
import { t } from '../lib/t';

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
