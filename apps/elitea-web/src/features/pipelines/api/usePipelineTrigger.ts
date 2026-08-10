import { useCallback } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { pipelineTriggerQueryKey, putPipelineTrigger, usePipelineTriggerQuery } from '@/entities/pipeline';
import type { PipelineTrigger, PipelineTriggerUpdateRequest } from '@/shared/api/generated/model';

export interface UsePipelineTriggerResult {
  readonly trigger: PipelineTrigger | undefined;
  readonly isFetching: boolean;
  readonly updateTrigger: (body: PipelineTriggerUpdateRequest) => Promise<PipelineTrigger>;
}

/**
 * Ported orchestration for `TriggerTypeSelector.jsx`'s
 * `useGetPipelineTriggerQuery`/`useUpdatePipelineTriggerMutation` pair
 * (`@/api/applications`, RTK Query).
 *
 * NOTE(#126): this used to call orval's `useGetPipelineTrigger` /
 * `getUpdatePipelineTriggerQueryOptions`. Those hooks are gone because #126
 * step 1 deleted the routes behind them — they were gated on a
 * `RouterConfig.PipelineRunner` nothing ever assigned, so they answered 404 in
 * every deployment. `entities/pipeline`'s hand-written client issues the exact
 * same requests, so this hook behaves as it always has; see #192/#193 for the
 * product gaps that have to be filled before it can do anything else.
 */
export function usePipelineTrigger(projectId: string | undefined, versionId: number | undefined): UsePipelineTriggerResult {
  const queryClient = useQueryClient();

  const query = usePipelineTriggerQuery(projectId, versionId);

  const updateTrigger = useCallback(
    async (body: PipelineTriggerUpdateRequest): Promise<PipelineTrigger> => {
      if (projectId === undefined || versionId === undefined) {
        throw new Error('usePipelineTrigger: projectId/versionId required to update a trigger');
      }
      const updated = await putPipelineTrigger(projectId, versionId, body);
      await queryClient.invalidateQueries({ queryKey: pipelineTriggerQueryKey(projectId, versionId) });
      return updated;
    },
    [projectId, versionId, queryClient],
  );

  return {
    trigger: query.data,
    isFetching: query.isFetching,
    updateTrigger,
  };
}
