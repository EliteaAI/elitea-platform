import { describe, expect, it } from 'vitest';

import { sortTagsSelectedFirst, toggleTagName, type RailTag } from './railTags';

const tags: readonly RailTag[] = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
  { id: 3, name: 'gamma' },
  { id: 4, name: 'delta' },
];

describe('sortTagsSelectedFirst', () => {
  it('leaves the list untouched when nothing is selected', () => {
    expect(sortTagsSelectedFirst(tags, []).map((tag) => tag.name)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });

  it('moves every selected tag to the front, keeping the unselected order', () => {
    expect(sortTagsSelectedFirst(tags, ['gamma']).map((tag) => tag.name)).toEqual(['gamma', 'alpha', 'beta', 'delta']);
  });

  it('orders the selected block by the SELECTION order, not by the tag-list order', () => {
    // Categories.jsx:112 maps over `selectedTags`, not over `tagList` — so a
    // chip picked second stays second and does not jump to the front.
    expect(sortTagsSelectedFirst(tags, ['delta', 'beta']).map((tag) => tag.name)).toEqual(['delta', 'beta', 'alpha', 'gamma']);
  });

  it('never renders a tag twice when it is both selected and present in the list', () => {
    const names = sortTagsSelectedFirst(tags, ['alpha', 'beta']).map((tag) => tag.name);
    expect(names).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('drops a selected name that matches no tag row (the baseline `.filter(tag => tag)`)', () => {
    expect(sortTagsSelectedFirst(tags, ['ghost', 'beta']).map((tag) => tag.name)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
  });

  it('resolves such a name from `extraTags` when the caller has a second cache', () => {
    const extra: readonly RailTag[] = [{ id: 9, name: 'ghost' }];
    expect(sortTagsSelectedFirst(tags, ['ghost'], extra).map((tag) => tag.name)).toEqual(['ghost', 'alpha', 'beta', 'gamma', 'delta']);
  });

  it('does not mutate its input', () => {
    const input = [...tags];
    sortTagsSelectedFirst(input, ['delta']);
    expect(input.map((tag) => tag.name)).toEqual(['alpha', 'beta', 'gamma', 'delta']);
  });
});

describe('toggleTagName', () => {
  it('appends an unselected name', () => {
    expect(toggleTagName(['alpha'], 'beta')).toEqual(['alpha', 'beta']);
  });

  it('removes a selected name', () => {
    expect(toggleTagName(['alpha', 'beta'], 'alpha')).toEqual(['beta']);
  });

  it('returns a new array rather than mutating', () => {
    const selected = ['alpha'];
    expect(toggleTagName(selected, 'beta')).not.toBe(selected);
    expect(selected).toEqual(['alpha']);
  });
});
