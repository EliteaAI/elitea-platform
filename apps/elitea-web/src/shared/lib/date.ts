/**
 * Date/time helpers and constants ported from
 * apps/elitea-ui/src/common/{utils.jsx,constants.js} (unit S3, spec §9.3).
 */

/** `constants.js:516-519`. */
export const TIME_FORMAT = {
  DDMMYYYY: 'dd-mm-yyyy',
  MMMDD: 'MMM, dd',
} as const;

export type TimeFormat = (typeof TIME_FORMAT)[keyof typeof TIME_FORMAT];

function convertToDDMMYYYY(dateString: string): string {
  if (!dateString) return '';
  const dateObj = new Date(dateString);
  const day = dateObj.getDate().toString().padStart(2, '0');
  const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const year = dateObj.getFullYear().toString();
  return `${day}.${month}.${year}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function convertToMMMDD(dateString: string): string {
  if (!dateString) return '';
  const dateObj = new Date(dateString);
  const day = dateObj.getDate().toString().padStart(2, '0');
  const month = MONTH_NAMES[dateObj.getMonth()];
  return `${month}, ${day}`;
}

/**
 * Formats `timeStamp` per `format`. Parity (old-app `utils.jsx:222-231`):
 * an unrecognised `format` returns the literal string `'unknow date'`
 * (misspelling preserved verbatim — it is user-facing copy in the shipped
 * app, N4).
 */
export function timeFormatter(timeStamp = '', format?: TimeFormat): string {
  switch (format) {
    case TIME_FORMAT.DDMMYYYY:
      return convertToDDMMYYYY(timeStamp);
    case TIME_FORMAT.MMMDD:
      return convertToMMMDD(timeStamp);
    case undefined:
    default:
      return 'unknow date';
  }
}

const DAY_IN_MILLISECONDS = 24 * 3600 * 1000;

/**
 * Days remaining until `expiration` (ISO string or anything `Date` accepts).
 * Returns `-1` for `expiration === null` (no expiry), `0` once expired,
 * `1` for anything expiring inside the next 24h, otherwise the rounded
 * whole-day count. `now` is injectable for deterministic tests; defaults to
 * `Date.now()` exactly like the old app (`utils.jsx:691-705`).
 */
export function calculateExpiryInDays(expiration: string | number | Date | null, now: number = Date.now()): number {
  if (expiration === null) {
    return -1;
  }
  const expiryTime = new Date(expiration).getTime();
  const duration = expiryTime - now;
  if (duration > DAY_IN_MILLISECONDS) {
    return Math.round(duration / DAY_IN_MILLISECONDS);
  }
  if (duration > 0) {
    return 1;
  }
  return 0;
}

/** `constants.js:473-474`. */
export const PERSONAL_SPACE_PERIOD_FOR_NEW_USER = 5 * 60 * 1000;
export const ALL_TIME_DATE = '2000-01-01T00:00:00';

/** `constants.js:476-480`. */
export const DEFAULT_TOKEN_EXPIRATION_DAYS = 30;
export const EXPIRATION_MEASURES = ['never', 'days', 'weeks', 'hours', 'minutes'] as const;
/** @public Wave-1 surface: type-only, for Wave-2 token/secret expiry-picker features. */
export type ExpirationMeasure = (typeof EXPIRATION_MEASURES)[number];

export const DEFAULT_RETENTION_VALUE = 1;
export const RETENTION_MEASURES = ['days', 'weeks', 'months', 'years'] as const;
/** @public Wave-1 surface: type-only, for Wave-2 retention-picker features. */
export type RetentionMeasure = (typeof RETENTION_MEASURES)[number];
