import { describe, expect, it } from 'vitest';

import { CollectionStatus } from '@/shared/lib/sort-status';

import { matchesItemStatus, normalizeStatuses } from './statuses';

describe('normalizeStatuses (parity: UserPublic.jsx:60-66)', () => {
  it('returns [All] when no statuses are selected', () => {
    expect(normalizeStatuses([])).toEqual([CollectionStatus.All]);
  });

  it('passes a non-empty selection through unchanged', () => {
    expect(normalizeStatuses([CollectionStatus.Draft, CollectionStatus.Published])).toEqual([
      CollectionStatus.Draft,
      CollectionStatus.Published,
    ]);
  });
});

describe('matchesItemStatus (client-side filter; parity: getQueryStatus.js semantics)', () => {
  it('matches everything when statuses is empty', () => {
    expect(matchesItemStatus('draft', [])).toBe(true);
    expect(matchesItemStatus(undefined, [])).toBe(true);
  });

  it('matches everything when statuses includes All, regardless of item status', () => {
    expect(matchesItemStatus('rejected', [CollectionStatus.All])).toBe(true);
    expect(matchesItemStatus(undefined, [CollectionStatus.All])).toBe(true);
  });

  it('matches only an item whose status is in the selection', () => {
    expect(matchesItemStatus(CollectionStatus.Published, [CollectionStatus.Published])).toBe(true);
    expect(matchesItemStatus(CollectionStatus.Draft, [CollectionStatus.Published])).toBe(false);
  });

  it('rejects an item with no status when a concrete status is required', () => {
    expect(matchesItemStatus(undefined, [CollectionStatus.Published])).toBe(false);
  });
});
