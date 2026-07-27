import type { Pipeline, PipelineTrigger } from './types';

/** `enabled` is nullable on the wire (v2.yaml:1289-1291); absent/null means not enabled. */
export function isTriggerEnabled(trigger: PipelineTrigger | undefined): boolean {
  return trigger?.enabled === true;
}

/** A human label for the trigger type, or "Manual" when none is configured. */
export function triggerTypeLabel(trigger: PipelineTrigger | undefined): string {
  if (trigger?.type === null || trigger?.type === undefined || trigger.type.trim() === '') return 'Manual';
  return trigger.type;
}

export function hasSchedule(pipeline: Pipeline): boolean {
  return pipeline.trigger?.schedule !== undefined && pipeline.trigger.schedule !== null;
}
