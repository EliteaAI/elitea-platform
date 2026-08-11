/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Pipeline, PipelineSettings, PipelineTrigger, PipelineTriggerWire } from './model/types';
export { hasSchedule, isTriggerEnabled, triggerTypeLabel } from './model/selectors';
export { normalisePipelineTrigger } from './lib/normalise';
// NOTE(#126): the pipeline-trigger client moved here from orval's generated
// `applications` module, whose `useGetPipelineTrigger` /
// `getUpdatePipelineTriggerQueryOptions` disappeared when the routes behind
// them were deleted. Requests are unchanged; see #192/#193 for the gaps.
export { pipelineTriggerQueryKey, putPipelineTrigger, usePipelineTriggerQuery } from './api/pipelineTriggerApi';
