import { describe, expect, it } from 'vitest';

import { combineSx } from './combineSx';

describe('combineSx', () => {
  it('returns an empty array when called with no arguments', () => {
    expect(combineSx()).toEqual([]);
  });

  it('drops undefined entries', () => {
    const style = { display: 'flex' };
    expect(combineSx(undefined, style, undefined)).toEqual([style]);
  });

  it('preserves a single plain object entry', () => {
    const style = { display: 'flex' };
    expect(combineSx(style)).toEqual([style]);
  });

  it('flattens an array-valued entry into the result (the previously uncovered branch)', () => {
    const a = { display: 'flex' };
    const b = { flexDirection: 'column' };
    expect(combineSx([a, b])).toEqual([a, b]);
  });

  it('flattens an array-valued entry alongside plain entries, preserving order', () => {
    const base = { display: 'flex' };
    const a = { flexDirection: 'column' };
    const b = { alignItems: 'center' };
    expect(combineSx(base, [a, b])).toEqual([base, a, b]);
  });

  it('preserves function-form sx values without unwrapping them', () => {
    const fn = () => ({ display: 'flex' });
    expect(combineSx(fn)).toEqual([fn]);
  });

  it('flattens multiple array-valued entries', () => {
    const a = { display: 'flex' };
    const b = { flexDirection: 'column' };
    const c = { alignItems: 'center' };
    expect(combineSx([a], [b, c])).toEqual([a, b, c]);
  });
});
