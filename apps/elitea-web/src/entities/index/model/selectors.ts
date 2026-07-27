import type { IndexItem, IndexStatus } from './types';

/**
 * apps/elitea-ui/src/[fsd]/features/toolkits/indexes/lib/constants/
 * indexDetails.constants.js:31-32 `RUNNABLE_INDEX_STATUSES` — "Statuses that
 * allow the index to be searched and run tools against": `completed`
 * (`success`) and `partly_indexed` (`partlyOk`). NOT `failed` — a failed
 * index is not runnable.
 */
const RUNNABLE_INDEX_STATUSES: readonly IndexStatus[] = ['completed', 'partly_indexed'];

export function isIndexRunnable(item: IndexItem): boolean {
  return RUNNABLE_INDEX_STATUSES.includes(item.metadata.state);
}

export function isIndexInProgress(item: IndexItem): boolean {
  return item.metadata.state === 'in_progress';
}

/**
 * apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/IndexListItem.jsx:
 * 26-30 — `skipped` arrives either as a bare number or `{total_skipped}`;
 * normalise to a single number for display.
 */
export function skippedCount(item: IndexItem): number {
  const skipped = item.metadata.skipped;
  if (skipped === undefined) return 0;
  return typeof skipped === 'number' ? skipped : skipped.totalSkipped;
}

/**
 * apps/elitea-ui/src/[fsd]/features/toolkits/indexes/model/indexes.slice.js
 * :72 `selectIndexesAvailable`.
 */
export function hasIndexes(items: readonly IndexItem[]): boolean {
  return items.length > 0;
}
