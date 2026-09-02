/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * Only what a consumer imports today. The reducer and the frame adapter are
 * internal: the hook is the seam, and exporting the reducer would invite a
 * second caller to drive it with its own loop — which is exactly the read-once
 * hazard useWikiGeneration exists to prevent.
 */
export type { GenerationState, ThinkingStep } from './model/types';
export { POLL_INTERVAL_MS, useWikiGeneration } from './model/useWikiGeneration';
