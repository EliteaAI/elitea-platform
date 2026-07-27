import { describe, expect, it } from 'vitest';

import { hasIndexes, isIndexInProgress, isIndexRunnable, skippedCount } from './selectors';
import type { IndexItem, IndexStatus } from './types';

const item = (state: IndexStatus, skipped?: IndexItem['metadata']['skipped']): IndexItem => ({
  id: '1',
  metadata: { collection: 'my-repo', state, ...(skipped !== undefined ? { skipped } : {}) },
});

describe('isIndexRunnable', () => {
  it('is true for completed', () => {
    expect(isIndexRunnable(item('completed'))).toBe(true);
  });

  it('is true for partly_indexed', () => {
    expect(isIndexRunnable(item('partly_indexed'))).toBe(true);
  });

  it('is false for failed', () => {
    expect(isIndexRunnable(item('failed'))).toBe(false);
  });

  it('is false for in_progress', () => {
    expect(isIndexRunnable(item('in_progress'))).toBe(false);
  });
});

describe('isIndexInProgress', () => {
  it('is true only for in_progress', () => {
    expect(isIndexInProgress(item('in_progress'))).toBe(true);
    expect(isIndexInProgress(item('completed'))).toBe(false);
  });
});

describe('skippedCount', () => {
  it('returns 0 when absent', () => {
    expect(skippedCount(item('completed'))).toBe(0);
  });

  it('returns the number directly when skipped is a number', () => {
    expect(skippedCount(item('completed', 3))).toBe(3);
  });

  it('unwraps totalSkipped when skipped is an object', () => {
    expect(skippedCount(item('completed', { totalSkipped: 7 }))).toBe(7);
  });
});

describe('hasIndexes', () => {
  it('is false for an empty list', () => {
    expect(hasIndexes([])).toBe(false);
  });

  it('is true when at least one item is present', () => {
    expect(hasIndexes([item('completed')])).toBe(true);
  });
});
