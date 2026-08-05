import { describe, expect, it } from 'vitest';

import {
  advanceCursor,
  clampCursor,
  computeSlice,
  computeSliceSize,
  nextRotationState,
} from './mutation-rotation.mjs';

// ---------------------------------------------------------------------------
// computeSliceSize
// ---------------------------------------------------------------------------
describe('computeSliceSize', () => {
  it('returns 0 for poolSize 0', () => {
    expect(computeSliceSize(0)).toBe(0);
  });

  it('returns 1 for a small pool (< 20)', () => {
    // ceil(5 * 0.05) = ceil(0.25) = 1
    expect(computeSliceSize(5)).toBe(1);
    expect(computeSliceSize(1)).toBe(1);
    expect(computeSliceSize(19)).toBe(1);
  });

  it('returns 1 for poolSize 20 (5% = 1 exactly)', () => {
    expect(computeSliceSize(20)).toBe(1);
  });

  it('returns 2 for poolSize 21 (ceil(1.05) = 2)', () => {
    expect(computeSliceSize(21)).toBe(2);
  });

  it('returns 5 for poolSize 100 (5%)', () => {
    expect(computeSliceSize(100)).toBe(5);
  });

  it('returns 7 for poolSize 140 (ceil(7) = 7)', () => {
    expect(computeSliceSize(140)).toBe(7);
  });

  it('respects minimum-1 — a pool of 3 yields 1 (not 0)', () => {
    // ceil(3 * 0.05) = ceil(0.15) = 1
    expect(computeSliceSize(3)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// clampCursor
// ---------------------------------------------------------------------------
describe('clampCursor', () => {
  it('returns 0 for poolSize 0 (degenerate)', () => {
    expect(clampCursor(0, 0)).toBe(0);
    expect(clampCursor(99, 0)).toBe(0);
  });

  it('passes through a valid cursor unchanged', () => {
    expect(clampCursor(0, 10)).toBe(0);
    expect(clampCursor(5, 10)).toBe(5);
    expect(clampCursor(9, 10)).toBe(9);
  });

  it('clamps a negative cursor to 0', () => {
    expect(clampCursor(-1, 10)).toBe(0);
    expect(clampCursor(-100, 10)).toBe(0);
  });

  it('clamps cursor >= poolSize to poolSize - 1 (pool shrank)', () => {
    expect(clampCursor(10, 10)).toBe(9);
    expect(clampCursor(15, 10)).toBe(9);
    expect(clampCursor(1000, 5)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// computeSlice
// ---------------------------------------------------------------------------
describe('computeSlice', () => {
  const pool10 = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']; // poolSize=10 → sliceSize=1

  it('returns empty array for empty pool', () => {
    expect(computeSlice([], 0)).toEqual([]);
  });

  it('returns a single file for a small pool at cursor 0', () => {
    const result = computeSlice(pool10, 0);
    expect(result).toEqual(['a']);
  });

  it('returns the correct file at an interior cursor', () => {
    const result = computeSlice(pool10, 5);
    expect(result).toEqual(['f']);
  });

  it('wraps around when cursor + sliceSize exceeds pool end', () => {
    // poolSize=10 → sliceSize=1, but let's use a larger pool for wrap
    // pool of 21 → sliceSize=2; cursor at position 20 wraps to index 0
    const pool21 = Array.from({ length: 21 }, (_, i) => `f${i}`);
    // sliceSize = ceil(21*0.05) = ceil(1.05) = 2
    const result = computeSlice(pool21, 20);
    expect(result).toEqual(['f20', 'f0']); // wraps
  });

  it('handles a pool of exactly 1 file', () => {
    expect(computeSlice(['only.ts'], 0)).toEqual(['only.ts']);
  });

  it('returns all files when sliceSize == poolSize (100% sample)', () => {
    // pool of 1 → sliceSize=1 → all 1 file returned regardless of cursor
    const pool1 = ['x.ts'];
    expect(computeSlice(pool1, 0)).toEqual(['x.ts']);
  });

  it('never returns duplicates when slice does not wrap', () => {
    const pool100 = Array.from({ length: 100 }, (_, i) => `src/shared/lib/util${i}.ts`);
    const result = computeSlice(pool100, 10);
    expect(new Set(result).size).toBe(result.length);
    expect(result).toHaveLength(5); // ceil(100*0.05)=5
  });
});

// ---------------------------------------------------------------------------
// advanceCursor
// ---------------------------------------------------------------------------
describe('advanceCursor', () => {
  it('returns 0 for empty pool', () => {
    expect(advanceCursor(0, 0, 0)).toBe(0);
  });

  it('advances by sliceSize (no wrap)', () => {
    expect(advanceCursor(0, 5, 100)).toBe(5);
    expect(advanceCursor(10, 5, 100)).toBe(15);
  });

  it('wraps around at poolSize boundary', () => {
    // cursor=9, sliceSize=1, poolSize=10 → next = (9+1)%10 = 0
    expect(advanceCursor(9, 1, 10)).toBe(0);
  });

  it('wraps mid-advance', () => {
    // cursor=8, sliceSize=5, poolSize=10 → (8+5)%10 = 3
    expect(advanceCursor(8, 5, 10)).toBe(3);
  });

  it('advancing by a full poolSize lands back at cursor (modular identity)', () => {
    expect(advanceCursor(3, 10, 10)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// nextRotationState (integration across all functions)
// ---------------------------------------------------------------------------
describe('nextRotationState', () => {
  const pool = Array.from({ length: 20 }, (_, i) => `src/shared/lib/f${i}.ts`);
  const now = '2026-08-05T12:00:00.000Z';

  it('returns the correct first slice at cursor 0', () => {
    const state = { cursor: 0, poolSize: 20, lastRunAt: null };
    const { slice, nextState } = nextRotationState(state, pool, now);
    expect(slice).toEqual([pool[0]]); // poolSize=20 → sliceSize=1
    expect(nextState.cursor).toBe(1);
    expect(nextState.poolSize).toBe(20);
    expect(nextState.lastRunAt).toBe(now);
  });

  it('two consecutive states sample non-overlapping slices (key contract)', () => {
    const state1 = { cursor: 0, poolSize: 20, lastRunAt: null };
    const { slice: slice1, nextState: state2 } = nextRotationState(state1, pool, now);
    const { slice: slice2 } = nextRotationState(state2, pool, now);
    // They must not share any files (pool=20, sliceSize=1 → trivially non-overlapping)
    const set1 = new Set(slice1);
    const overlap = slice2.filter(f => set1.has(f));
    expect(overlap).toEqual([]);
  });

  it('clamps cursor when pool shrank', () => {
    // Cursor was 18 in a 20-file pool, but now only 10 files remain
    const shrunkPool = Array.from({ length: 10 }, (_, i) => `src/shared/lib/g${i}.ts`);
    const staleState = { cursor: 18, poolSize: 20, lastRunAt: now };
    const { slice, nextState } = nextRotationState(staleState, shrunkPool, now);
    // cursor clamped to 9; slice starts at 9
    expect(slice).toContain(shrunkPool[9]);
    expect(nextState.poolSize).toBe(10);
  });

  it('clamps cursor when pool grew and old cursor was at old end', () => {
    const grownPool = Array.from({ length: 40 }, (_, i) => `src/shared/lib/h${i}.ts`);
    const staleState = { cursor: 19, poolSize: 20, lastRunAt: now };
    // cursor 19 is valid in pool-40 — no clamping needed
    const { slice, nextState } = nextRotationState(staleState, grownPool, now);
    expect(slice).toContain(grownPool[19]);
    expect(nextState.poolSize).toBe(40);
  });

  it('handles empty pool gracefully (returns empty slice, cursor stays 0)', () => {
    const state = { cursor: 0, poolSize: 0, lastRunAt: null };
    const { slice, nextState } = nextRotationState(state, [], now);
    expect(slice).toEqual([]);
    expect(nextState.cursor).toBe(0);
    expect(nextState.poolSize).toBe(0);
  });

  it('defaults a missing cursor to 0', () => {
    const badState = { cursor: undefined, poolSize: 0, lastRunAt: null };
    const { slice } = nextRotationState(badState, pool, now);
    expect(slice[0]).toBe(pool[0]);
  });

  it('wraps around after the last file in the pool', () => {
    // pool of 10, sliceSize=1; cursor=9 → next=0
    const p10 = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    const state = { cursor: 9, poolSize: 10, lastRunAt: null };
    const { nextState } = nextRotationState(state, p10, now);
    expect(nextState.cursor).toBe(0);
  });

  it('covers all files after poolSize consecutive runs (full coverage guarantee)', () => {
    const p = Array.from({ length: 20 }, (_, i) => `g${i}.ts`);
    const seen = new Set();
    let state = { cursor: 0, poolSize: 20, lastRunAt: null };
    for (let run = 0; run < 20; run++) {
      const { slice, nextState } = nextRotationState(state, p, now);
      slice.forEach(f => seen.add(f));
      state = nextState;
    }
    // After 20 runs of sliceSize=1, all 20 files should have been covered
    expect(seen.size).toBe(20);
  });
});
