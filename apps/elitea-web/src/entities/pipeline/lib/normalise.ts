import type { PipelineTrigger, PipelineTriggerWire } from '../model/types';

/**
 * snake_case wire shape -> camelCase `PipelineTrigger` domain type
 * (`src/shared/api/generated/model/pipelineTrigger.zod.ts`, v2.yaml:1284-1306;
 * internal/api/v2/pipelines/handler.go:122-127,136-141,153-158,187-192). The
 * only field rename is `version_id` -> `versionId`; `enabled`/`schedule`/
 * `type` are already single-word so no rename is needed, but they ARE
 * `.nullish()` (optional AND nullable) on the wire, matching `PipelineTrigger`'s
 * own `?: T | null` fields, so the key is only included when the wire actually
 * sent something other than `undefined` — an omitted wire key stays absent
 * here too, per the `exactOptionalPropertyTypes` optional-field spread
 * pattern (see `entities/canvas/lib/normalise.ts`), rather than being forced
 * to an explicit `undefined`.
 */
export function normalisePipelineTrigger(wire: PipelineTriggerWire): PipelineTrigger {
  return {
    versionId: wire.version_id,
    ...(wire.enabled !== undefined ? { enabled: wire.enabled } : {}),
    ...(wire.schedule !== undefined ? { schedule: wire.schedule } : {}),
    ...(wire.type !== undefined ? { type: wire.type } : {}),
  };
}
