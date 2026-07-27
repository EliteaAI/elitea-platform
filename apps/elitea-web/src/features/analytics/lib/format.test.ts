import { describe, expect, it } from 'vitest';

import { fmtDuration, fmtNum, UNAVAILABLE_METRIC } from './format';

describe('fmtNum', () => {
  it.each([
    [null, '0'],
    [undefined, '0'],
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1_000, '1.0K'],
    [1_500, '1.5K'],
    [999_999, '1000.0K'],
    [1_000_000, '1.0M'],
    [2_500_000, '2.5M'],
  ])('fmtNum(%p) === %p', (input, expected) => {
    expect(fmtNum(input)).toBe(expected);
  });
});

describe('fmtDuration', () => {
  it.each([
    [null, '-'],
    [undefined, '-'],
    [0, '0ms'],
    [999, '999ms'],
    [1000, '1.0s'],
    [1500, '1.5s'],
    [12345, '12.3s'],
  ])('fmtDuration(%p) === %p', (input, expected) => {
    expect(fmtDuration(input)).toBe(expected);
  });
});

describe('UNAVAILABLE_METRIC', () => {
  it('is a single em dash, distinct from any real formatted number', () => {
    expect(UNAVAILABLE_METRIC).toBe('–');
    expect(UNAVAILABLE_METRIC).not.toBe(fmtNum(0));
  });
});
