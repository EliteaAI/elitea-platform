import type { Bucket } from './types';

/** Pinned buckets first, then alphabetical by name — the common list-ordering pattern. */
export function sortBucketsPinnedFirst(buckets: readonly Bucket[]): Bucket[] {
  return [...buckets].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function isPinnedBucket(bucket: Bucket): boolean {
  return bucket.isPinned;
}

/** Case-insensitive substring filter over bucket names. */
export function filterBucketsByQuery(buckets: readonly Bucket[], query: string): Bucket[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...buckets];
  return buckets.filter((bucket) => bucket.name.toLowerCase().includes(needle));
}
