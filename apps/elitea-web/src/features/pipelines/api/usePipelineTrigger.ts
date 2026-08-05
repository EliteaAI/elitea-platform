import { useCallback } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import {
  getUpdatePipelineTriggerQueryOptions,
  useGetPipelineTrigger,
} from '@/shared/api/generated/applications/applications';
import type { PipelineTrigger, PipelineTriggerUpdateRequest } from '@/shared/api/generated/model';

export interface UsePipelineTriggerResult {
  readonly trigger: PipelineTrigger | undefined;
  readonly isFetching: boolean;
  readonly updateTrigger: (body: PipelineTriggerUpdateRequest) => Promise<PipelineTrigger>;
}

/**
 * Ported orchestration for `TriggerTypeSelector.jsx`'s
 * `useGetPipelineTriggerQuery`/`useUpdatePipelineTriggerMutation` pair
 * (`@/api/applications`, RTK Query). The generated equivalents
 * (`useGetPipelineTrigger` / `updatePipelineTrigger`,
 * `internal/api/v2/pipelines/handler.go:117-193`) are real, but the write
 * side is generated `useQuery`-shaped, not `useMutation`-shaped -- see
 * `entities/application-form/model/mutations.ts`'s own doc comment for why
 * every POST/PUT/DELETE in this generated client is `useQuery`-shaped, and
 * `features/agents/lib/hooks/useDisassociateToolkit.hooks.ts`'s own doc
 * comment for the established imperative-trigger convention this hook
 * reuses: `queryClient.fetchQuery(getUpdatePipelineTriggerQueryOptions(...))`.
 */
export function usePipelineTrigger(projectId: string | undefined, versionId: number | undefined): UsePipelineTriggerResult {
  const queryClient = useQueryClient();

  const query = useGetPipelineTrigger(projectId ?? '', versionId ?? 0, {
    query: { enabled: projectId !== undefined && versionId !== undefined },
  });

  const updateTrigger = useCallback(
    async (body: PipelineTriggerUpdateRequest): Promise<PipelineTrigger> => {
      if (projectId === undefined || versionId === undefined) {
        throw new Error('usePipelineTrigger: projectId/versionId required to update a trigger');
      }
      const options = getUpdatePipelineTriggerQueryOptions(projectId, versionId, body);
      const response = await queryClient.fetchQuery(options);
      await queryClient.invalidateQueries({ queryKey: query.queryKey });
      // The declared response type includes the error-envelope variants;
      // never actually reachable here since `eliteaFetch` throws instead of
      // resolving with them (mutator.ts's §3.6 unwrap contract) -- same
      // established cast every generated-client caller in this app applies.
      return response.data as PipelineTrigger;
    },
    [projectId, versionId, queryClient, query.queryKey],
  );

  return {
    trigger: query.data?.data as PipelineTrigger | undefined,
    isFetching: query.isFetching,
    updateTrigger,
  };
}
