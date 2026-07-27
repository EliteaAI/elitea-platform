import { describe, expect, it } from 'vitest';

import {
  deduplicateVersionByAuthor,
  markAllDuplicatesByMultipleKeys,
  removeDuplicateObjects,
  uniqueArrayByProp,
} from './array';

describe('removeDuplicateObjects', () => {
  it('keeps the first occurrence of each id', () => {
    const input = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 1, v: 'c' }];
    expect(removeDuplicateObjects(input)).toEqual([{ id: 1, v: 'a' }, { id: 2, v: 'b' }]);
  });

  it('defaults to [] with no argument', () => {
    expect(removeDuplicateObjects()).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(removeDuplicateObjects([])).toEqual([]);
  });

  it('treats distinct ids as all-unique', () => {
    const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(removeDuplicateObjects(input)).toEqual(input);
  });
});

describe('uniqueArrayByProp', () => {
  it('keeps only the first item per prop value', () => {
    const input = [
      { id: 1, group: 'a' },
      { id: 2, group: 'a' },
      { id: 3, group: 'b' },
    ];
    expect(uniqueArrayByProp(input, 'group')).toEqual([{ id: 1, group: 'a' }, { id: 3, group: 'b' }]);
  });

  it('returns [] for an empty array', () => {
    expect(uniqueArrayByProp([], 'id')).toEqual([]);
  });

  it('returns every item when all prop values are distinct', () => {
    const input = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(uniqueArrayByProp(input, 'id')).toEqual(input);
  });

  it(
    'preserved quirk (N4): a first-occurrence FALSY element is dropped, not kept, ' +
      'because the old filter tests array[index] truthiness rather than "is a real index"',
    () => {
      // index 0 holds `false` itself; the algorithm's filter step evaluates
      // `array[0]` for truthiness, and `false` is falsy, so this legitimate
      // first occurrence (unique `id` — `false.id` is `undefined`) is
      // silently dropped instead of kept.
      const input = [false, { id: 1 }] as unknown as ReadonlyArray<{ id: number }>;
      const result = uniqueArrayByProp(input, 'id');
      expect(result).not.toContain(false);
      expect(result).toEqual([{ id: 1 }]);
    },
  );
});

describe('markAllDuplicatesByMultipleKeys', () => {
  it('flags items sharing a case-insensitive composite key across all given keys', () => {
    const input = [
      { firstName: 'John', lastName: 'Doe' },
      { firstName: 'john', lastName: 'DOE' },
      { firstName: 'Jane', lastName: 'Doe' },
    ];
    const result = markAllDuplicatesByMultipleKeys(input, ['firstName', 'lastName']);
    expect(result.map((r) => r.isDuplicate)).toEqual([true, true, false]);
  });

  it('returns [] for an empty array', () => {
    expect(markAllDuplicatesByMultipleKeys([], ['id'])).toEqual([]);
  });

  it('treats missing key values as the empty-string segment (Array.join semantics)', () => {
    const input = [{ a: undefined, b: 'x' }, { a: undefined, b: 'x' }] as Array<{
      a: string | undefined;
      b: string;
    }>;
    const result = markAllDuplicatesByMultipleKeys(input, ['a', 'b']);
    expect(result.every((r) => r.isDuplicate)).toBe(true);
  });
});

describe('deduplicateVersionByAuthor', () => {
  it('returns unique name|avatar|id author signatures', () => {
    const versions = [
      { author: { name: 'Alice', avatar: 'a.png', id: 1 } },
      { author: { name: 'Alice', avatar: 'a.png', id: 1 } },
      { author: { name: 'Bob', avatar: 'b.png', id: 2 } },
    ];
    expect(deduplicateVersionByAuthor(versions)).toEqual(['Alice|a.png|1', 'Bob|b.png|2']);
  });

  it('defaults missing author fields to empty string segments', () => {
    expect(deduplicateVersionByAuthor([{ author: {} }])).toEqual(['||']);
  });

  it('defaults to [] with no argument', () => {
    expect(deduplicateVersionByAuthor()).toEqual([]);
  });

  it('returns [] when given a non-array (defensive parity check)', () => {
    expect(deduplicateVersionByAuthor('nope' as unknown as never[])).toEqual([]);
  });
});
