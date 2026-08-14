import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { AgentToolAssociation } from './types';

/**
 * The ONE real "attach/detach a toolkit instance to a version" call, shared
 * by `ui/ToolMenu.tsx` (attach) and `lib/hooks/useDisassociateToolkit.hooks.ts`
 * (detach). `PATCH /elitea_core/tool/prompt_lib/{project_id}/{toolkit_id}`
 * with `has_relation` — see `ToolMenu.tsx`'s own module doc comment for why
 * there is no orval-generated wrapper for it and why calling `eliteaFetch`
 * directly is the established pattern here.
 *
 * Go side (`internal/api/v2/toolkits/handler.go`'s `Update` ->
 * `updateToolRelation`, read directly, not inferred):
 *  - `has_relation: true`  -> `INSERT INTO p_{id}.entity_tool_mapping
 *    (entity_version_id, entity_id, entity_type, tool_id) ... ON CONFLICT DO
 *    NOTHING`
 *  - `has_relation: false` -> `DELETE FROM p_{id}.entity_tool_mapping WHERE
 *    entity_version_id = $1 AND tool_id = $2`
 * and `applications/handler.go`'s `fetchVersionDetails` reads that same
 * table back into `version_details.tools[]`, so both directions genuinely
 * round-trip.
 *
 * **The URL's `{toolkit_id}` is `elitea_tools.id`, i.e. the version tool
 * row's `tool_id` — NOT its `id`.** `fetchVersionDetails` emits `id` =
 * `entity_tool_mapping.id` (the MAPPING row's own serial) and `tool_id` =
 * the joined toolkit instance; the two id spaces are unrelated. Sending
 * `id` addresses whichever toolkit instance happens to share that serial —
 * see `resolveToolkitId` below.
 */
export interface ToolkitRelationParams {
  readonly projectId: string;
  readonly applicationId: number;
  readonly versionId: number;
  /** `elitea_tools.id` — use {@link resolveToolkitId} when starting from a version's `tools[]` row. */
  readonly toolkitId: string | number;
  readonly hasRelation: boolean;
}

/** Rejects (does not resolve `false`) on failure — `eliteaFetch` throws `EliteaApiError`; callers that want a boolean wrap it themselves. */
export async function setToolkitRelation({
  projectId,
  applicationId,
  versionId,
  toolkitId,
  hasRelation,
}: ToolkitRelationParams): Promise<void> {
  await eliteaFetch(`/elitea_core/tool/prompt_lib/${projectId}/${toolkitId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_version_id: versionId,
      entity_id: applicationId,
      // Hardcoded to 'agent' for both agents and pipelines, exactly as the
      // baseline's own `useAssociateToolkit`/`useDisassociateToolkit` did
      // (verified against `apps/elitea-ui/src/hooks/application/
      // useLibraryToolkits.js` and `useDisassociateToolkit.hooks.js`), and as
      // the already-landed attach path in `ToolMenu.tsx` does. The DELETE
      // branch does not filter on `entity_type` at all, and the INSERT's
      // unique key includes it, so the attach and the detach must agree on
      // this literal or a detach silently matches nothing.
      entity_type: 'agent',
      has_relation: hasRelation,
    }),
  });
}

/**
 * The `elitea_tools.id` to address a version `tools[]` row by. Falls back to
 * `id` only for rows that carry no `tool_id` at all (`application_tools`
 * legacy rows — those are `type: 'application'` sub-agent entries, which take
 * the separate `updateApplicationRelation` path instead, so the fallback is
 * defensive rather than load-bearing).
 */
export function resolveToolkitId(tool: AgentToolAssociation): string | number | undefined {
  return tool.tool_id ?? tool.id;
}
