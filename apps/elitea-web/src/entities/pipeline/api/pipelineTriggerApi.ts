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
 * The requests below are byte-identical to the generated ones. The module is
 * KEPT rather than deleted. The capability it serves is tracked as two product
 * gaps: #192 (inbound webhook pipeline trigger) and #193 (scheduled execution).
 * A deletion would only force someone to write the port again.
 *
 * What changed: the SPA no longer FIRES these requests. The read query is
 * disabled and the two trigger types that write are hidden, both keyed on
 * the `pipelineTriggers` capability (`shared/config/backendCapabilities`).
 * Turn it on in the same change that mounts the routes.
 */
import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { hasBackendCapability } from '@/shared/config';
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
  // The route is not mounted, so the GET can only 404. A disabled query keeps
  // the page from firing one on every mount — see
  // `shared/config/backendCapabilities`.
  const enabled = hasBackendCapability('pipelineTriggers')
    && (options?.enabled ?? true) && projectId !== undefined && versionId !== undefined;
  return useQuery({
    queryKey: pipelineTriggerQueryKey(projectId ?? '', versionId ?? 0),
    queryFn: () => fetchPipelineTrigger(projectId ?? '', versionId ?? 0),
    enabled,
  });
}
