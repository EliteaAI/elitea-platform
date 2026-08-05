import { describe, expect, it } from 'vitest';

import { presetToDateRange, toIsoRange } from './dateRange';

describe('presetToDateRange', () => {
  it('subtracts exactly `days` calendar days from `now` and returns `now` as `to`', () => {
    const now = new Date('2026-07-27T12:00:00.000Z');
    const { from, to } = presetToDateRange(7, now);
    expect(to.toISOString()).toBe(now.toISOString());
    expect(from.toISOString()).toBe('2026-07-20T12:00:00.000Z');
  });

  it('handles the 1-day preset', () => {
    const now = new Date('2026-07-27T00:00:00.000Z');
    const { from } = presetToDateRange(1, now);
    expect(from.toISOString()).toBe('2026-07-26T00:00:00.000Z');
  });

  it('rides over a month boundary correctly (setDate, not naive subtraction)', () => {
    const now = new Date('2026-08-02T00:00:00.000Z');
    const { from } = presetToDateRange(30, now);
    expect(from.toISOString()).toBe('2026-07-03T00:00:00.000Z');
  });

  it('does not mutate the `now` argument', () => {
    const now = new Date('2026-07-27T00:00:00.000Z');
    const before = now.toISOString();
    presetToDateRange(7, now);
    expect(now.toISOString()).toBe(before);
  });

  it('returns a `to` that is a distinct Date instance from `now` (not the same reference)', () => {
    const now = new Date('2026-07-27T00:00:00.000Z');
    const { to } = presetToDateRange(7, now);
    expect(to).not.toBe(now);
    expect(to.getTime()).toBe(now.getTime());
  });
});

describe('toIsoRange', () => {
  it('converts a {from,to} Date pair to ISO 8601 strings', () => {
    const from = new Date('2026-07-20T12:00:00.000Z');
    const to = new Date('2026-07-27T12:00:00.000Z');
    expect(toIsoRange({ from, to })).toEqual({
      dateFrom: '2026-07-20T12:00:00.000Z',
      dateTo: '2026-07-27T12:00:00.000Z',
    });
  });
});
