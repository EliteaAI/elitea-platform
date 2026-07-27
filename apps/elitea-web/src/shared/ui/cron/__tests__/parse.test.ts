import { describe, expect, it } from 'vitest';

import { parseCronExpression } from '../parse';

describe('parseCronExpression — structural validation', () => {
  it('rejects an empty string', () => {
    const result = parseCronExpression('');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('Cron expression is required');
  });

  it('rejects a whitespace-only string', () => {
    const result = parseCronExpression('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string input', () => {
    // Runtime guard for a caller that bypasses the TS type (e.g. a prop
    // fed by an un-typed API response).
    const result = parseCronExpression(undefined as unknown as string);
    expect(result.ok).toBe(false);
  });

  it('rejects fewer than 5 parts', () => {
    const result = parseCronExpression('* * * *');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('Cron must have exactly 5 parts with space between every part');
  });

  it('rejects more than 5 parts', () => {
    const result = parseCronExpression('* * * * * *');
    expect(result.ok).toBe(false);
  });

  it('tolerates repeated whitespace between parts', () => {
    const result = parseCronExpression('0   0  *  *   6');
    expect(result.ok).toBe(true);
  });
});

describe('parseCronExpression — wildcard', () => {
  it('parses "*" for every field', () => {
    const result = parseCronExpression('* * * * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.minute).toEqual({ kind: 'every' });
    expect(result.state.hour).toEqual({ kind: 'every' });
    expect(result.state.dayOfMonth).toEqual({ kind: 'every' });
    expect(result.state.month).toEqual({ kind: 'every' });
    expect(result.state.dayOfWeek).toEqual({ kind: 'every' });
  });
});

describe('parseCronExpression — list', () => {
  it('parses a single value as a one-element list', () => {
    const result = parseCronExpression('0 0 * * 6');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.minute).toEqual({ kind: 'list', values: [0] });
    expect(result.state.dayOfWeek).toEqual({ kind: 'list', values: [6] });
  });

  it('sorts and deduplicates an unordered list', () => {
    const result = parseCronExpression('5,3,5,10 * * * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.minute).toEqual({ kind: 'list', values: [3, 5, 10] });
  });

  it('rejects a list value above the field bound', () => {
    const result = parseCronExpression('60 * * * *');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('Invalid minute value: "60"');
  });

  it('rejects a list value below the field bound (dayOfMonth is 1-31)', () => {
    const result = parseCronExpression('0 0 0 * *');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('Invalid day value: "0"');
  });

  it('rejects a non-numeric token', () => {
    const result = parseCronExpression('abc * * * *');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('Invalid minute value: "abc"');
  });

  it('accepts the minute upper bound (59) and rejects one past it', () => {
    expect(parseCronExpression('59 * * * *').ok).toBe(true);
    expect(parseCronExpression('60 * * * *').ok).toBe(false);
  });

  it('accepts the hour upper bound (23) and rejects one past it', () => {
    expect(parseCronExpression('0 23 * * *').ok).toBe(true);
    expect(parseCronExpression('0 24 * * *').ok).toBe(false);
  });

  it('accepts the month bounds (1 and 12) and rejects 0 and 13', () => {
    expect(parseCronExpression('0 0 * 1 *').ok).toBe(true);
    expect(parseCronExpression('0 0 * 12 *').ok).toBe(true);
    expect(parseCronExpression('0 0 * 0 *').ok).toBe(false);
    expect(parseCronExpression('0 0 * 13 *').ok).toBe(false);
  });

  it('accepts dayOfMonth bounds (1 and 31) and rejects 32', () => {
    expect(parseCronExpression('0 0 1 * *').ok).toBe(true);
    expect(parseCronExpression('0 0 31 * *').ok).toBe(true);
    expect(parseCronExpression('0 0 32 * *').ok).toBe(false);
  });
});

describe('parseCronExpression — dayOfWeek 7=Sunday normalisation', () => {
  it('normalises a bare "7" to canonical "0"', () => {
    const result = parseCronExpression('0 0 * * 7');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.dayOfWeek).toEqual({ kind: 'list', values: [0] });
  });

  it('normalises "7" inside a list alongside other values', () => {
    const result = parseCronExpression('0 0 * * 1,7');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.dayOfWeek).toEqual({ kind: 'list', values: [0, 1] });
  });

  it('rejects a range whose upper bound is "7": normalisation turns it into a descending range', () => {
    // "5-7" normalises to from=5,to=0 (7 -> 0) and is rejected by the same
    // from<=to rule as any other descending range — see the normalizeValue
    // comment in parse.ts for why this is a deliberate non-goal, not a bug.
    const result = parseCronExpression('0 0 * * 5-7');
    expect(result.ok).toBe(false);
  });

  it('accepts "0-7" (both endpoints normalise to 0): a degenerate but valid single-day range', () => {
    const result = parseCronExpression('0 0 * * 0-7');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.dayOfWeek).toEqual({ kind: 'range', from: 0, to: 0 });
  });

  it('rejects a weekday value above 7', () => {
    const result = parseCronExpression('0 0 * * 8');
    expect(result.ok).toBe(false);
  });
});

describe('parseCronExpression — range', () => {
  it('parses a valid ascending range', () => {
    const result = parseCronExpression('0 9 * * 1-5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.dayOfWeek).toEqual({ kind: 'range', from: 1, to: 5 });
  });

  it('rejects a descending range (from > to)', () => {
    // Note: normalising "5-7" (from < to before normalisation) can legally
    // produce from=5,to=0 above — this case is a genuinely descending range
    // with NO 7-wraparound involved (dayOfMonth has no such normalisation).
    const result = parseCronExpression('0 0 20-10 * *');
    expect(result.ok).toBe(false);
  });

  it('rejects a range with an out-of-bounds endpoint', () => {
    const result = parseCronExpression('0 0 * 1-13 *');
    expect(result.ok).toBe(false);
  });
});

describe('parseCronExpression — step', () => {
  it('parses "*/N"', () => {
    const result = parseCronExpression('*/5 * * * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.minute).toEqual({ kind: 'step', step: 5 });
  });

  it('rejects a step of 0', () => {
    const result = parseCronExpression('*/0 * * * *');
    expect(result.ok).toBe(false);
  });

  it('rejects a step above the field bound', () => {
    expect(parseCronExpression('0 */24 * * *').ok).toBe(false);
    expect(parseCronExpression('0 */23 * * *').ok).toBe(true);
  });

  it('rejects a malformed step (non-numeric)', () => {
    const result = parseCronExpression('*/x * * * *');
    expect(result.ok).toBe(false);
  });
});
