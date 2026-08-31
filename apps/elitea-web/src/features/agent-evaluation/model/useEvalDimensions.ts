/**
 * React-query bindings for the dimension library.
 *
 * The key namespace is `['evalDimensions', projectId, …]` and every reader and
 * every invalidation goes through `evalDimensionQueryKeys`. Hand-built keys are
 * how a mutation invalidates one namespace while the list reads another: the
 * request succeeds, the cache is never refreshed, and the new row does not
 * appear until a reload — a 200 that looks like a write that did nothing
 * (#132's sibling defect).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createEvalDimension,
  deleteEvalDimension,
  fetchEvalDimensions,
  updateEvalDimension,
} from '../api/evaluationApi';
import type { EvalDimension, EvalDimensionWriteInput } from './types';

export const evalDimensionQueryKeys = {
  all: (projectId: string) => ['evalDimensions', projectId] as const,
  list: (projectId: string, applicationId: number | undefined) =>
    ['evalDimensions', projectId, 'list', applicationId ?? 'project'] as const,
};

export function useEvalDimensions(
  projectId: string | undefined,
  applicationId: number | undefined,
): ReturnType<typeof useQuery<EvalDimension[]>> {
  return useQuery<EvalDimension[]>({
    queryKey: evalDimensionQueryKeys.list(projectId ?? '', applicationId),
    queryFn: () => fetchEvalDimensions(projectId ?? '', applicationId === undefined ? {} : { applicationId }),
    enabled: projectId !== undefined && projectId !== '',
  });
}

interface UpdateArgs {
  readonly dimensionId: string;
  readonly input: EvalDimensionWriteInput;
}

export function useEvalDimensionMutations(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const invalidate = async (): Promise<void> => {
    if (projectId !== undefined && projectId !== '') {
      await queryClient.invalidateQueries({
        queryKey: evalDimensionQueryKeys.all(projectId),
      });
    }
  };

  return {
    create: useMutation({
      mutationFn: (input: EvalDimensionWriteInput) => createEvalDimension(projectId ?? '', input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (args: UpdateArgs) => updateEvalDimension(projectId ?? '', args.dimensionId, args.input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (dimensionId: string) => deleteEvalDimension(projectId ?? '', dimensionId),
      onSuccess: invalidate,
    }),
  };
}
