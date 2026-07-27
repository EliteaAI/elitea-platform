import { describe, expect, it } from 'vitest';

import { parseValueToIntNumber } from './number';

describe('parseValueToIntNumber', () => {
  it.each([
    ['0', 0],
    ['42', 42],
    ['007', ''],
    ['-1', ''],
    ['1.5', ''],
    ['', ''],
    ['abc', ''],
    ['1e3', ''],
    ['10', 10],
  ])('parseValueToIntNumber(%j) -> %j', (input, expected) => {
    expect(parseValueToIntNumber(input)).toBe(expected);
  });
});
