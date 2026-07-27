import { describe, expect, it } from 'vitest';

import {
  getComparator,
  getPinnedComparator,
  pinnedComparator,
  sortByCreatedAt,
  sortByName,
  stableSort,
} from './sort';

interface Item {
  readonly name: string;
  readonly value: number;
}

describe('getComparator / stableSort', () => {
  const items: Item[] = [
    { name: 'b', value: 2 },
    { name: 'a', value: 1 },
    { name: 'c', value: 3 },
  ];

  it('sorts ascending by a numeric field', () => {
    const sorted = stableSort(items, getComparator<Item>('asc', 'value'));
    expect(sorted.map((i) => i.value)).toEqual([1, 2, 3]);
  });

  it('sorts descending by a numeric field', () => {
    const sorted = stableSort(items, getComparator<Item>('desc', 'value'));
    expect(sorted.map((i) => i.value)).toEqual([3, 2, 1]);
  });

  it('sorts ascending by a string field, locale/case-insensitively', () => {
    const withCase: Item[] = [{ name: 'Banana', value: 1 }, { name: 'apple', value: 2 }];
    const sorted = stableSort(withCase, getComparator<Item>('asc', 'name'));
    expect(sorted.map((i) => i.name)).toEqual(['apple', 'Banana']);
  });

  it('stableSort preserves relative order of equal elements', () => {
    const tied = [
      { name: 'x', value: 1, tag: 'first' },
      { name: 'x', value: 1, tag: 'second' },
    ];
    const sorted = stableSort(tied, getComparator<(typeof tied)[number]>('asc', 'value'));
    expect(sorted.map((i) => i.tag)).toEqual(['first', 'second']);
  });

  it('stableSort does not mutate the input array', () => {
    const original = [...items];
    stableSort(items, getComparator<Item>('asc', 'value'));
    expect(items).toEqual(original);
  });
});

describe('pinnedComparator / getPinnedComparator', () => {
  it('pins pinned items first', () => {
    const a = { is_pinned: false };
    const b = { is_pinned: true };
    expect(pinnedComparator(a, b)).toBe(1);
    expect(pinnedComparator(b, a)).toBe(-1);
  });

  it('is 0 when pinned status matches', () => {
    expect(pinnedComparator({ is_pinned: true }, { is_pinned: true })).toBe(0);
    expect(pinnedComparator({}, {})).toBe(0);
  });

  it('getPinnedComparator falls back to 0 with no secondary comparator', () => {
    const cmp = getPinnedComparator();
    expect(cmp({ is_pinned: true }, { is_pinned: true })).toBe(0);
  });

  it('getPinnedComparator applies the secondary comparator within a pinned group', () => {
    const items = [
      { is_pinned: true, name: 'b' },
      { is_pinned: false, name: 'z' },
      { is_pinned: true, name: 'a' },
    ];
    const cmp = getPinnedComparator<(typeof items)[number]>(sortByName);
    const sorted = [...items].sort(cmp);
    expect(sorted.map((i) => i.name)).toEqual(['a', 'b', 'z']);
  });
});

describe('sortByCreatedAt', () => {
  it.each([
    ['2024-01-01', '2024-06-01', 1],
    ['2024-06-01', '2024-01-01', -1],
    ['2024-01-01', '2024-01-01', 0],
  ])('sortByCreatedAt(%j, %j) -> %j (newest first)', (a, b, expected) => {
    expect(sortByCreatedAt({ created_at: a }, { created_at: b })).toBe(expected);
  });
});

describe('sortByName', () => {
  it('sorts case-insensitively', () => {
    expect(sortByName({ name: 'apple' }, { name: 'Banana' })).toBeLessThan(0);
    expect(sortByName({ name: 'Banana' }, { name: 'apple' })).toBeGreaterThan(0);
    expect(sortByName({ name: 'Apple' }, { name: 'apple' })).toBe(0);
  });
});
