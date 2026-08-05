import { describe, expect, it } from 'vitest';

import { validateCronExpressionDaily } from './indexSchedule.helpers';

/**
 * Port-parity + complexity-refactor regression tests for
 * `indexSchedule.helpers.ts` (unit A4a). No baseline test file existed for
 * `indexSchedule.helpers.js` — this is new coverage, written directly
 * against the ported (and since-refactored, see the file's own doc
 * comments) implementation.
 */
describe('validateCronExpressionDaily', () => {
  it('accepts the index default cron ("0 0 * * 6" — once weekly, well under the daily floor)', () => {
    const result = validateCronExpressionDaily('0 0 * * 6');
    expect(result.isValid).toBe(true);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('rejects a wildcard minute with the daily-floor message, not the hourly one', () => {
    const result = validateCronExpressionDaily('* * * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects a sub-hourly minute step (violates the hourly floor first) with the daily message', () => {
    const result = validateCronExpressionDaily('*/30 * * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects a comma-list minute with the daily message', () => {
    const result = validateCronExpressionDaily('0,30 0 * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects an ascending minute range (fires more than once per hour) with the daily message', () => {
    const result = validateCronExpressionDaily('5-50 0 * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects an hour of "*" even when the minute passes the hourly floor (sub-hourly hour, not minute)', () => {
    const result = validateCronExpressionDaily('0 * * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects a comma-list hour', () => {
    const result = validateCronExpressionDaily('0 0,12 * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects an ascending hour range', () => {
    const result = validateCronExpressionDaily('0 9-17 * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('rejects an hour step below 24 (fires more than once per day)', () => {
    const result = validateCronExpressionDaily('0 */6 * * *');
    expect(result).toEqual({ isValid: false, message: 'Frequency cannot be more than once per day' });
  });

  it('passes through a genuine syntax error unchanged (not remapped to the daily-floor message)', () => {
    const result = validateCronExpressionDaily('not a cron');
    expect(result.isValid).toBe(false);
    expect(result.message).not.toBe('Frequency cannot be more than once per day');
  });

  it('passes through the "required" error for an empty expression', () => {
    const result = validateCronExpressionDaily('');
    expect(result).toEqual({ isValid: false, message: 'Cron expression is required' });
  });

  it('passes through the field-count error for the wrong number of parts', () => {
    const result = validateCronExpressionDaily('0 0 * *');
    expect(result.isValid).toBe(false);
    expect(result.message).toBe('Cron must have exactly 5 parts with space between every part');
  });

  it('passes through an out-of-range field error unchanged', () => {
    const result = validateCronExpressionDaily('0 99 * * *');
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('Invalid hour value');
  });
});
