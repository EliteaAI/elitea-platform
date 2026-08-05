import { describe, expect, it } from 'vitest';

import { toString } from './conversationStarters.helpers';

describe('toString', () => {
  it('coerces null to an empty string', () => {
    expect(toString(null)).toBe('');
  });

  it('coerces undefined to an empty string', () => {
    expect(toString(undefined)).toBe('');
  });

  it('passes a string value through unchanged', () => {
    expect(toString('hello')).toBe('hello');
  });

  it('stringifies a number', () => {
    expect(toString(42)).toBe('42');
  });

  it('stringifies zero without treating it as falsy/nullish', () => {
    expect(toString(0)).toBe('0');
  });
});
