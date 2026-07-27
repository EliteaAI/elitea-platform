import { describe, expect, it } from 'vitest';

import { dedupeTagsById, dedupeTagsByName, filterTagsByQuery, sortTagsByName, tagLabel } from './selectors';
import type { Tag } from './types';

const tag = (id: number, name: string): Tag => ({ id, name, data: null });

describe('sortTagsByName', () => {
  it('sorts case-insensitively', () => {
    const tags = [tag(1, 'zebra'), tag(2, 'Apple'), tag(3, 'banana')];
    expect(sortTagsByName(tags).map((t) => t.name)).toEqual(['Apple', 'banana', 'zebra']);
  });

  it('does not mutate the input array', () => {
    const tags = [tag(1, 'b'), tag(2, 'a')];
    const copy = [...tags];
    sortTagsByName(tags);
    expect(tags).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(sortTagsByName([])).toEqual([]);
  });
});

describe('dedupeTagsById', () => {
  it('keeps the first occurrence of each id', () => {
    const tags = [tag(1, 'first'), tag(2, 'other'), tag(1, 'duplicate')];
    expect(dedupeTagsById(tags)).toEqual([tag(1, 'first'), tag(2, 'other')]);
  });

  it('is a no-op when every id is unique', () => {
    const tags = [tag(1, 'a'), tag(2, 'b')];
    expect(dedupeTagsById(tags)).toEqual(tags);
  });
});

describe('dedupeTagsByName', () => {
  it('keeps the first occurrence of each name, distinct from id-based dedupe', () => {
    const tags = [tag(1, 'shared'), tag(2, 'shared'), tag(3, 'unique')];
    expect(dedupeTagsByName(tags)).toEqual([tag(1, 'shared'), tag(3, 'unique')]);
  });
});

describe('filterTagsByQuery', () => {
  const tags = [tag(1, 'Python'), tag(2, 'python-lib'), tag(3, 'Go')];

  it('matches case-insensitive substrings', () => {
    expect(filterTagsByQuery(tags, 'PY').map((t) => t.id)).toEqual([1, 2]);
  });

  it('returns every tag for a blank query', () => {
    expect(filterTagsByQuery(tags, '   ')).toEqual(tags);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterTagsByQuery(tags, 'rust')).toEqual([]);
  });
});

describe('tagLabel', () => {
  it('returns the name when non-blank', () => {
    expect(tagLabel(tag(1, 'ml'))).toBe('ml');
  });

  it('falls back to #id when the name is blank', () => {
    expect(tagLabel(tag(7, '   '))).toBe('#7');
  });
});
