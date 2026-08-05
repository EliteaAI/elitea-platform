/**
 * Rotation arithmetic for scripts/mutate-spotcheck.mjs — spec §6.7 / issue #62.
 *
 * All functions are pure (no I/O, no side effects). The orchestration script
 * owns reading/writing parity/mutation-rotation-state.json; these functions
 * only compute the next state.
 *
 * Design:
 *   - Pool is sorted alphabetically and stable across runs (filesystem order
 *     is not stable; explicit sort is).
 *   - 5% slice, minimum 1 file.
 *   - Cursor wraps around the end of the pool (modular arithmetic).
 *   - If the pool grows or shrinks between runs, the cursor is clamped to
 *     [0, newPoolSize - 1] so it stays valid without resetting to 0 and
 *     biasing early-alphabet files.
 *
 * Exported API surface:
 *   computeSliceSize(poolSize)          → int  (≥1)
 *   clampCursor(cursor, poolSize)       → int
 *   computeSlice(pool, cursor)          → string[]  (the files to mutate)
 *   advanceCursor(cursor, sliceSize, poolSize) → int  (next cursor value)
 *   nextRotationState(currentState, pool, now) → { slice, nextState }
 */

/**
 * How many files to include in one mutation run (5% of pool, minimum 1).
 * @param {number} poolSize
 * @returns {number}
 */
export function computeSliceSize(poolSize) {
  if (poolSize <= 0) return 0;
  return Math.max(1, Math.ceil(poolSize * 0.05));
}

/**
 * Clamp a cursor to a valid index for a pool of the given size.
 * If poolSize is 0, returns 0 (degenerate; the caller should bail early).
 * Never resets to 0 blindly — clamps to poolSize-1 when the pool shrank.
 * @param {number} cursor
 * @param {number} poolSize
 * @returns {number}
 */
export function clampCursor(cursor, poolSize) {
  if (poolSize <= 0) return 0;
  if (cursor < 0) return 0;
  if (cursor >= poolSize) return poolSize - 1;
  return cursor;
}

/**
 * Compute the slice of files to mutate from the sorted pool.
 * The slice wraps around the end of the array (modular arithmetic).
 * @param {string[]} sortedPool  - alphabetically sorted file paths
 * @param {number}   cursor      - current cursor (already clamped)
 * @returns {string[]}
 */
export function computeSlice(sortedPool, cursor) {
  const poolSize = sortedPool.length;
  if (poolSize === 0) return [];
  const sliceSize = computeSliceSize(poolSize);
  const result = [];
  for (let i = 0; i < sliceSize; i++) {
    result.push(sortedPool[(cursor + i) % poolSize]);
  }
  return result;
}

/**
 * Advance the cursor by one slice, wrapping around.
 * @param {number} cursor
 * @param {number} sliceSize
 * @param {number} poolSize
 * @returns {number}
 */
export function advanceCursor(cursor, sliceSize, poolSize) {
  if (poolSize <= 0) return 0;
  return (cursor + sliceSize) % poolSize;
}

/**
 * The main entry point: given the current persisted state and the live pool,
 * return both the slice to mutate NOW and the state to write back after the run.
 *
 * Handles pool-size drift: if poolSize recorded in currentState differs from
 * pool.length, the cursor is clamped before computing the slice.
 *
 * @param {{ cursor: number, poolSize: number, lastRunAt: string|null }} currentState
 * @param {string[]} sortedPool  - the live, alphabetically-sorted file list
 * @param {string}   now         - ISO timestamp string (caller provides so this fn is pure)
 * @returns {{ slice: string[], nextState: { cursor: number, poolSize: number, lastRunAt: string } }}
 */
export function nextRotationState(currentState, sortedPool, now) {
  const poolSize = sortedPool.length;
  const rawCursor = typeof currentState.cursor === 'number' ? currentState.cursor : 0;
  const cursor = clampCursor(rawCursor, poolSize);
  const slice = computeSlice(sortedPool, cursor);
  const sliceSize = computeSliceSize(poolSize);
  const nextCursor = advanceCursor(cursor, sliceSize, poolSize);
  return {
    slice,
    nextState: { cursor: nextCursor, poolSize, lastRunAt: now },
  };
}
