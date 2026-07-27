/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Bucket, BucketWire } from './model/types';
export { filterBucketsByQuery, isPinnedBucket, sortBucketsPinnedFirst } from './model/selectors';
export { normaliseBucket, normaliseBuckets } from './lib/normalise';
