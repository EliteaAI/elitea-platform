import { describe, expect, it } from 'vitest';

import { normaliseBucket, normaliseBuckets } from './normalise';
import type { BucketWire } from '../model/types';

const wire: BucketWire = { name: 'artifacts', is_pinned: true, created_at: '2026-01-01T00:00:00Z' };

describe('normaliseBucket', () => {
  it('maps snake_case wire fields to camelCase', () => {
    expect(normaliseBucket(wire)).toEqual({
      id: 'artifacts',
      name: 'artifacts',
      isPinned: true,
      createdAt: '2026-01-01T00:00:00Z',
      retentionDays: null,
    });
  });

  it('carries retention_days through, and folds an absent one to null', () => {
    expect(normaliseBucket({ ...wire, retention_days: 30 }).retentionDays).toBe(30);
    expect(normaliseBucket({ ...wire, retention_days: null }).retentionDays).toBeNull();
    // Absent, not null: pre-retention responses must not become `undefined`,
    // which the edit form would render as the string "undefined".
    expect(normaliseBucket(wire).retentionDays).toBeNull();
  });

  it('uses the name as the id — the handler exposes no surrogate id', () => {
    expect(normaliseBucket({ ...wire, name: 'uploads' }).id).toBe('uploads');
  });

  it('preserves a false is_pinned rather than defaulting it', () => {
    expect(normaliseBucket({ ...wire, is_pinned: false }).isPinned).toBe(false);
  });
});

describe('normaliseBuckets', () => {
  it('maps every entry in order', () => {
    const second: BucketWire = { ...wire, name: 'uploads' };
    expect(normaliseBuckets([wire, second]).map((b) => b.id)).toEqual(['artifacts', 'uploads']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseBuckets([])).toEqual([]);
  });
});
