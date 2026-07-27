import type { Bucket, BucketWire } from '../model/types';

/** snake_case wire shape -> camelCase domain type (`Bucket`, v2.yaml:1702-1713). */
export function normaliseBucket(wire: BucketWire): Bucket {
  return {
    id: wire.id,
    name: wire.name,
    isPinned: wire.is_pinned,
    createdAt: wire.created_at,
  };
}

export function normaliseBuckets(wire: readonly BucketWire[]): Bucket[] {
  return wire.map(normaliseBucket);
}
