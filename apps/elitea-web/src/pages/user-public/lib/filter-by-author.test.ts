import { describe, expect, it } from 'vitest';

import { filterByAuthor, matchesAuthor } from './filter-by-author';

describe('matchesAuthor', () => {
  it('matches everything when no authorId is given', () => {
    expect(matchesAuthor({}, '')).toBe(true);
  });

  it('matches via the authors[] co-author list', () => {
    expect(matchesAuthor({ authors: [{ id: 'a1' }, { id: 'a2' }] }, 'a2')).toBe(true);
  });

  it('matches via owner_id when authors[] does not contain the id', () => {
    expect(matchesAuthor({ authors: [{ id: 'a1' }], owner_id: 'a9' }, 'a9')).toBe(true);
  });

  it('rejects when neither authors[] nor owner_id match', () => {
    expect(matchesAuthor({ authors: [{ id: 'a1' }], owner_id: 'a9' }, 'a2')).toBe(false);
  });

  it('rejects when authors and owner_id are both absent', () => {
    expect(matchesAuthor({}, 'a2')).toBe(false);
  });
});

describe('filterByAuthor', () => {
  const items = [
    { id: '1', owner_id: 'a1' },
    { id: '2', owner_id: 'a2' },
    { id: '3', authors: [{ id: 'a1' }], owner_id: 'a3' },
  ];

  it('returns a new array unchanged when authorId is empty', () => {
    const result = filterByAuthor(items, '');
    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('keeps only items matching the given author', () => {
    expect(filterByAuthor(items, 'a1').map((i) => i.id)).toEqual(['1', '3']);
  });

  it('returns an empty array when no item matches', () => {
    expect(filterByAuthor(items, 'nope')).toEqual([]);
  });
});
