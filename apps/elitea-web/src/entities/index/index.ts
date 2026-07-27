/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { IndexHistoryEntry, IndexItem, IndexMetadata, IndexSchedule, IndexStatus } from './model/types';
export { hasIndexes, isIndexInProgress, isIndexRunnable, skippedCount } from './model/selectors';
