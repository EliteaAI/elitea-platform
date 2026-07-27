import { describe, expect, it } from 'vitest';

import { normaliseBucket, normaliseBuckets } from './normalise';
import type { BucketWire } from '../model/types';

const wire: BucketWire = { id: 'b1', name: 'artifacts', is_pinned: true, created_at: '2026-01-01T00:00:00Z' };

describe('normaliseBucket', () => {
  it('maps snake_case wire fields to camelCase', () => {
    expect(normaliseBucket(wire)).toEqual({
      id: 'b1',
      name: 'artifacts',
      isPinned: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('preserves a false is_pinned rather than defaulting it', () => {
    expect(normaliseBucket({ ...wire, is_pinned: false }).isPinned).toBe(false);
  });
});

describe('normaliseBuckets', () => {
  it('maps every entry in order', () => {
    const second: BucketWire = { ...wire, id: 'b2', name: 'uploads' };
    expect(normaliseBuckets([wire, second]).map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseBuckets([])).toEqual([]);
  });
});
