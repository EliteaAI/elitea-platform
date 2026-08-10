/**
 * Hand-written client for the pipeline-trigger endpoints.
 *
 * NOTE(#126): these three routes — GET/POST/PUT
 * `/elitea_core/pipeline_trigger/prompt_lib/{projectId}/pipeline/{versionId}/trigger`
 * — were registered behind a nil `RouterConfig.PipelineRunner`, whose only
 * implementation was the prototype indexer Redis RPC transport. Nothing ever
 * assigned it, so the routes answered **404 in every deployment**, and #126
 * step 1 deleted them from the router and from `api/openapi/v2.yaml`. That
 * removed the orval-generated `useGetPipelineTrigger` /
 * `getUpdatePipelineTriggerQueryOptions` this module replaces.
 *
 * The requests below are byte-identical to the generated ones, so the UI
 * behaves exactly as it did before the deletion — it still calls the same URLs
 * and still gets a 404. Migrating these call sites is deliberately NOT part of
 * that deletion; the capability they need is tracked as two product gaps,
 * #192 (inbound webhook pipeline trigger) and #193 (scheduled execution).
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import type { PipelineTrigger, PipelineTriggerUpdateRequest } from '@/shared/api/generated/model';

function triggerUrl(projectId: string, versionId: number): string {
  return `/elitea_core/pipeline_trigger/prompt_lib/${projectId}/pipeline/${versionId}/trigger`;
}

/** Matches the generated key shape so cache invalidation keeps working unchanged. */
export function pipelineTriggerQueryKey(projectId: string, versionId: number): readonly unknown[] {
  return [triggerUrl(projectId, versionId)] as const;
}

async function fetchPipelineTrigger(projectId: string, versionId: number): Promise<PipelineTrigger> {
  const envelope = await eliteaFetch<{ data: PipelineTrigger }>(triggerUrl(projectId, versionId));
  return envelope.data;
}

export async function putPipelineTrigger(
  projectId: string,
  versionId: number,
  body: PipelineTriggerUpdateRequest,
): Promise<PipelineTrigger> {
  const envelope = await eliteaFetch<{ data: PipelineTrigger }>(triggerUrl(projectId, versionId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return envelope.data;
}

export function usePipelineTriggerQuery(
  projectId: string | undefined,
  versionId: number | undefined,
  options?: { readonly enabled?: boolean },
): UseQueryResult<PipelineTrigger> {
  const enabled = (options?.enabled ?? true) && projectId !== undefined && versionId !== undefined;
  return useQuery({
    queryKey: pipelineTriggerQueryKey(projectId ?? '', versionId ?? 0),
    queryFn: () => fetchPipelineTrigger(projectId ?? '', versionId ?? 0),
    enabled,
  });
}
