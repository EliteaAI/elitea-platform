import { describe, expect, it } from 'vitest';

import { numField, strField } from './looseRecord';

describe('numField', () => {
  it('returns the number when the field is a real number, including 0', () => {
    expect(numField({ n: 42 }, 'n')).toBe(42);
    expect(numField({ n: 0 }, 'n')).toBe(0);
  });

  it('falls back to 0 (default) for a missing key', () => {
    expect(numField({}, 'n')).toBe(0);
  });

  it('falls back to 0 (default) for a non-number value', () => {
    expect(numField({ n: '42' }, 'n')).toBe(0);
    expect(numField({ n: null }, 'n')).toBe(0);
    expect(numField({ n: undefined }, 'n')).toBe(0);
  });

  it('honours an explicit fallback', () => {
    expect(numField({}, 'n', -1)).toBe(-1);
  });
});

describe('strField', () => {
  it('returns the string when the field is a real string, including empty string', () => {
    expect(strField({ s: 'hello' }, 's')).toBe('hello');
    expect(strField({ s: '' }, 's')).toBe('');
  });

  it("falls back to '' (default) for a missing key", () => {
    expect(strField({}, 's')).toBe('');
  });

  it("falls back to '' (default) for a non-string value", () => {
    expect(strField({ s: 42 }, 's')).toBe('');
    expect(strField({ s: null }, 's')).toBe('');
  });

  it('honours an explicit fallback', () => {
    expect(strField({}, 's', 'fallback')).toBe('fallback');
  });
});
