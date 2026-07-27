import { describe, expect, it } from 'vitest';

import { deepCloneObject, isNullOrUndefined, updateObjectByPath } from './object';
import type { PlainData } from './object';

describe('deepCloneObject', () => {
  it.each<[PlainData, PlainData]>([
    [null, null],
    [0, 0],
    [false, false],
    ['', ''],
    ['hello', 'hello'],
    [42, 42],
  ])('returns falsy/primitive input unchanged: %j', (input, expected) => {
    expect(deepCloneObject(input)).toBe(expected);
  });

  it('deep-clones a nested object (no shared references)', () => {
    const original = { a: 1, nested: { b: 2, list: [1, 2, { c: 3 }] } };
    const clone = deepCloneObject(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(clone.nested).not.toBe(original.nested);
    expect(clone.nested.list).not.toBe(original.nested.list);
  });

  it('deep-clones arrays element-by-element', () => {
    const original = [{ a: 1 }, { b: 2 }];
    const clone = deepCloneObject(original);
    expect(clone).toEqual(original);
    expect(clone[0]).not.toBe(original[0]);
  });

  it('mutating the clone does not affect the original', () => {
    const original = { a: { b: 1 } };
    const clone = deepCloneObject(original);
    clone.a.b = 999;
    expect(original.a.b).toBe(1);
  });

  it(
    'preserved quirk (N4): a Date is walked via Object.keys (0 own-enumerable ' +
      'properties) so it "clones" to an empty plain object, silently losing the value',
    () => {
      const original = { when: new Date('2024-01-01T00:00:00.000Z') as unknown as PlainData };
      const clone = deepCloneObject(original);
      expect(clone.when).toEqual({});
      expect(clone.when).not.toBeInstanceOf(Date);
    },
  );
});

describe('updateObjectByPath', () => {
  it('sets a top-level path', () => {
    const result = updateObjectByPath({ a: 1 }, 'a', 2);
    expect(result).toEqual({ a: 2 });
  });

  it('does not mutate the original object', () => {
    const original = { a: { b: 1 } };
    updateObjectByPath(original, 'a.b', 2);
    expect(original.a.b).toBe(1);
  });

  it('sets a nested path that already exists', () => {
    const result = updateObjectByPath({ a: { b: 1, c: 2 } }, 'a.b', 99);
    expect(result).toEqual({ a: { b: 99, c: 2 } });
  });

  it('merges when both current and new values are plain objects and replace is falsy', () => {
    const result = updateObjectByPath({ a: { x: 1, y: 2 } }, 'a', { y: 20, z: 3 });
    expect(result).toEqual({ a: { x: 1, y: 20, z: 3 } });
  });

  it('replaces instead of merging when replace=true', () => {
    const result = updateObjectByPath({ a: { x: 1, y: 2 } }, 'a', { z: 3 }, true);
    expect(result).toEqual({ a: { z: 3 } });
  });

  it('replaces arrays wholesale rather than merging by index', () => {
    const result = updateObjectByPath({ a: [1, 2, 3] }, 'a', [9]);
    expect(result).toEqual({ a: [9] });
  });

  it('creates intermediate objects for a path that does not exist yet', () => {
    const result = updateObjectByPath({}, 'a.b.c', 1);
    expect(result).toEqual({ a: { b: { c: 1 } } });
  });

  it('sets a new top-level array value wholesale', () => {
    const result = updateObjectByPath({}, 'list', [1, 2]);
    expect(result).toEqual({ list: [1, 2] });
  });

  it('sets a new top-level object value as a shallow copy', () => {
    const value = { x: 1 };
    const result = updateObjectByPath<Record<string, PlainData>>({}, 'obj', value);
    expect(result['obj']).toEqual({ x: 1 });
    expect(result['obj']).not.toBe(value);
  });

  it('overwrites a primitive with a new primitive at an existing path', () => {
    const result = updateObjectByPath({ a: 'old' }, 'a', 'new');
    expect(result).toEqual({ a: 'new' });
  });
});

describe('isNullOrUndefined', () => {
  it.each([
    [null, true],
    [undefined, true],
    [0, false],
    ['', false],
    [false, false],
    [NaN, false],
    [{}, false],
  ])('isNullOrUndefined(%j) -> %j', (input, expected) => {
    expect(isNullOrUndefined(input)).toBe(expected);
  });
});
