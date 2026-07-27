import { describe, expect, it } from 'vitest';

import {
  ALL_TIME_DATE,
  DEFAULT_RETENTION_VALUE,
  DEFAULT_TOKEN_EXPIRATION_DAYS,
  EXPIRATION_MEASURES,
  PERSONAL_SPACE_PERIOD_FOR_NEW_USER,
  RETENTION_MEASURES,
  TIME_FORMAT,
  calculateExpiryInDays,
  timeFormatter,
} from './date';

describe('timeFormatter', () => {
  // Noon UTC (not midnight) so the local-time getters the old app uses
  // (`getDate`/`getMonth`) cannot cross a day boundary in any real timezone
  // (UTC-12..UTC+14), keeping the test deterministic in CI regardless of
  // the runner's TZ.
  it('formats DDMMYYYY', () => {
    expect(timeFormatter('2024-03-05T12:00:00.000Z', TIME_FORMAT.DDMMYYYY)).toBe('05.03.2024');
  });

  it('formats MMMDD', () => {
    expect(timeFormatter('2024-03-05T12:00:00.000Z', TIME_FORMAT.MMMDD)).toBe('Mar, 05');
  });

  it('returns "" for an empty timestamp regardless of format', () => {
    expect(timeFormatter('', TIME_FORMAT.DDMMYYYY)).toBe('');
    expect(timeFormatter('', TIME_FORMAT.MMMDD)).toBe('');
  });

  it('returns the literal "unknow date" (parity: preserved misspelling, N4) for an unrecognised format', () => {
    expect(timeFormatter('2024-01-01', undefined)).toBe('unknow date');
  });

  it('defaults timeStamp to "" with no argument', () => {
    expect(timeFormatter(undefined, TIME_FORMAT.DDMMYYYY)).toBe('');
  });
});

describe('calculateExpiryInDays', () => {
  const NOW = new Date('2024-01-10T00:00:00.000Z').getTime();

  it('returns -1 for expiration === null (no expiry)', () => {
    expect(calculateExpiryInDays(null, NOW)).toBe(-1);
  });

  it('returns 0 once already expired', () => {
    expect(calculateExpiryInDays('2024-01-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it('returns 0 at the exact expiry instant (duration === 0)', () => {
    expect(calculateExpiryInDays(new Date(NOW).toISOString(), NOW)).toBe(0);
  });

  it('returns 1 for anything expiring within the next 24h but after now', () => {
    const inTwoHours = new Date(NOW + 2 * 3600 * 1000).toISOString();
    expect(calculateExpiryInDays(inTwoHours, NOW)).toBe(1);
  });

  it('returns the rounded whole-day count beyond 24h', () => {
    const inThreeDays = new Date(NOW + 3 * 24 * 3600 * 1000).toISOString();
    expect(calculateExpiryInDays(inThreeDays, NOW)).toBe(3);
  });

  it('rounds to the nearest day (not floor/ceil) for a partial-day duration', () => {
    // 2.5 days -> rounds to 3 (Math.round(2.5) === 3).
    const twoAndHalfDays = NOW + 2.5 * 24 * 3600 * 1000;
    expect(calculateExpiryInDays(new Date(twoAndHalfDays).toISOString(), NOW)).toBe(3);
  });

  it('defaults `now` to Date.now() when omitted', () => {
    const soon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
    expect(calculateExpiryInDays(soon)).toBe(5);
  });
});

describe('date/retention constants', () => {
  it('exposes the expected literal shapes', () => {
    expect(TIME_FORMAT).toEqual({ DDMMYYYY: 'dd-mm-yyyy', MMMDD: 'MMM, dd' });
    expect(DEFAULT_TOKEN_EXPIRATION_DAYS).toBe(30);
    expect(EXPIRATION_MEASURES).toEqual(['never', 'days', 'weeks', 'hours', 'minutes']);
    expect(DEFAULT_RETENTION_VALUE).toBe(1);
    expect(RETENTION_MEASURES).toEqual(['days', 'weeks', 'months', 'years']);
    expect(PERSONAL_SPACE_PERIOD_FOR_NEW_USER).toBe(5 * 60 * 1000);
    expect(ALL_TIME_DATE).toBe('2000-01-01T00:00:00');
  });
});
