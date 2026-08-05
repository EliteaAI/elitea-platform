import { describe, expect, it } from 'vitest';

import { mergeSortAndFilterByTags } from './merge-and-sort';

describe('mergeSortAndFilterByTags (parity: AllStuffList.jsx:150-179)', () => {
  const apps = [
    { id: 'app-old', created_at: '2026-01-01T00:00:00Z', tags: ['t1'] },
    { id: 'app-new', created_at: '2026-03-01T00:00:00Z', tags: ['t1', 't2'] },
  ];
  const pipelines = [{ id: 'pipe-mid', created_at: '2026-02-01T00:00:00Z', tags: ['t2'] }];

  it('merges multiple lists and sorts newest-first by created_at', () => {
    const result = mergeSortAndFilterByTags([apps, pipelines], []);
    expect(result.map((i) => i.id)).toEqual(['app-new', 'pipe-mid', 'app-old']);
  });

  it('passes everything through when no tags are selected', () => {
    const result = mergeSortAndFilterByTags([apps], []);
    expect(result).toHaveLength(2);
  });

  it('filters to items containing a single selected tag, keeping newest-first order', () => {
    const result = mergeSortAndFilterByTags([apps, pipelines], ['t2']);
    expect(result.map((i) => i.id)).toEqual(['app-new', 'pipe-mid']);
  });

  it('requires ALL selected tags to be present (AND semantics) for multiple selected tags', () => {
    const result = mergeSortAndFilterByTags([apps, pipelines], ['t1', 't2']);
    expect(result.map((i) => i.id)).toEqual(['app-new']);
  });

  it('excludes items with no tags at all when a tag filter is active', () => {
    const untagged = [{ id: 'no-tags', created_at: '2026-01-01T00:00:00Z' }];
    expect(mergeSortAndFilterByTags([untagged], ['t1'])).toEqual([]);
  });

  it('does not mutate the input lists', () => {
    const copy = [...apps];
    mergeSortAndFilterByTags([apps], []);
    expect(apps).toEqual(copy);
  });
});
