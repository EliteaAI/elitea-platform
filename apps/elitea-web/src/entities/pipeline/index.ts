/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Pipeline, PipelineSettings, PipelineTrigger } from './model/types';
export { hasSchedule, isTriggerEnabled, triggerTypeLabel } from './model/selectors';
