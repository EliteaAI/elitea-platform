/**
 * features/credentials/api/useConfigurations.ts — TanStack Query hooks
 * wrapping `./configurations.ts` (unit A7). Substitutes for the baseline's
 * RTK Query cache: query-key based caching replaces `providesTags`, and
 * explicit `invalidateQueries` calls replace `invalidatesTags` (spec §2.3 —
 * "TanStack Query + zustand", no Redux/RTK Query anywhere in the new app).
 *
 * Query-key convention: `['credentials', 'configurations', projectId, ...]`
 * so `invalidateQueries({ queryKey: ['credentials', 'configurations'] })`
 * (no projectId) invalidates every list for every project at once — the
 * same "wipe the whole configurations surface" scope the baseline's shared
 * `TAG_CONFIGURATIONS`/`TAG_SHARED_CONFIGURATIONS` tags had.
 *
 * SCOPE NOTE: this file wraps the 8 of the 16 `./configurations.ts`
 * endpoints this unit's own `pages/credentials`/`features/credentials`
 * screens actually call (API-145/146/149/150/152/153/154/155). The
 * remaining 8 (API-147/148/151/156..160 —
 * `getConfigurationsByType`/`getConfigurationsBySection`/
 * `getSharedConfigurations`/`toggleConfigurationSharing`/`listModels`/
 * `listCredentialTypes`/`setProjectDefaultModel`/`getTtsVoices`) are fully
 * implemented AND independently contract-tested directly against
 * `./configurations.ts` (`configurations.test.ts` — satisfying API-147/
 * 148/151/156/157/158/159/160's manifest acceptance, which is about the
 * endpoint's request/response contract, not about a query-hook wrapper
 * existing). No hook wrapper is added for them here because they have no
 * real consumer yet within this unit's own pages (a hook with zero call
 * sites is untestable-as-a-hook and a dead export under `knip
 * --max-issues 0`, per this program's established discipline — see the
 * decision record's "First real CI run" section for the exact class of
 * problem this avoids). Add the wrapper back, mirroring the pattern below,
 * the moment a real caller needs one.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';

import { batchTestConfigurationConnection, testConfigurationConnection } from './configurationConnections';
import type { BatchTestConnectionItem, BatchTestResultRow } from './configurationConnections';
import {
  createConfiguration,
  deleteConfiguration,
  getAvailableConfigurationsType,
  getConfigurationDetail,
  getConfigurationsList,
  updateConfiguration,
} from './configurations';
import type {
  ConfigurationPageWire,
  ConfigurationTypeDescriptor,
  ConfigurationWire,
  CreateConfigurationBody,
  GetAvailableConfigurationsTypeParams,
  GetConfigurationsListParams,
  UpdateConfigurationBody,
} from './configurations';

/**
 * Root key every credentials query/mutation shares — the invalidation
 * scope. Not exported (R-D1/knip): no caller outside this file needs to
 * invalidate credentials data directly today; export it the moment one
 * does, rather than carrying a currently-dead export.
 */
const CONFIGURATIONS_QUERY_ROOT = ['credentials', 'configurations'] as const;
const MODELS_QUERY_ROOT = ['credentials', 'models'] as const;

/* ── API-145 ───────────────────────────────────────────────────────────── */

export function useAvailableConfigurationsType(
  params: GetAvailableConfigurationsTypeParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ConfigurationTypeDescriptor[]> {
  return useQuery({
    queryKey: [...CONFIGURATIONS_QUERY_ROOT, 'available', params],
    queryFn: ({ signal }) => getAvailableConfigurationsType(params, signal),
    enabled: options.enabled ?? true,
  });
}

/* ── API-146 ───────────────────────────────────────────────────────────── */

export function useConfigurationsList(
  params: GetConfigurationsListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ConfigurationPageWire> {
  return useQuery({
    queryKey: [...CONFIGURATIONS_QUERY_ROOT, 'list', params],
    queryFn: ({ signal }) => getConfigurationsList(params, signal),
    enabled: options.enabled ?? true,
  });
}

/* ── API-149 ───────────────────────────────────────────────────────────── */

export function useCreateConfiguration(): UseMutationResult<
  ConfigurationWire,
  Error,
  { projectId: string | number; body: CreateConfigurationBody }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, body }) => createConfiguration(projectId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONFIGURATIONS_QUERY_ROOT });
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_ROOT });
    },
  });
}

/* ── API-150 ───────────────────────────────────────────────────────────── */

export function useConfigurationDetail(
  projectId: string | number | undefined,
  configId: string | number | undefined,
  options: Pick<UseQueryOptions<ConfigurationWire>, 'enabled'> = {},
): UseQueryResult<ConfigurationWire> {
  return useQuery({
    queryKey: [...CONFIGURATIONS_QUERY_ROOT, 'detail', projectId, configId],
    queryFn: ({ signal }) => getConfigurationDetail(projectId as string | number, configId as string | number, signal),
    enabled: (options.enabled ?? true) && projectId !== undefined && configId !== undefined,
  });
}

/* ── API-152 ───────────────────────────────────────────────────────────── */

export function useUpdateConfiguration(): UseMutationResult<
  ConfigurationWire,
  Error,
  { projectId: string | number; configId: string | number; body: UpdateConfigurationBody }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, configId, body }) => updateConfiguration(projectId, configId, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: CONFIGURATIONS_QUERY_ROOT });
      void queryClient.invalidateQueries({
        queryKey: [...CONFIGURATIONS_QUERY_ROOT, 'detail', variables.projectId, variables.configId],
      });
    },
  });
}

/* ── API-153 ───────────────────────────────────────────────────────────── */

export function useDeleteConfiguration(): UseMutationResult<
  unknown,
  Error,
  { projectId: string | number; configId: string | number }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, configId }) => deleteConfiguration(projectId, configId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONFIGURATIONS_QUERY_ROOT });
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_ROOT });
    },
  });
}

/* ── API-154 ───────────────────────────────────────────────────────────── */

export function useTestConfigurationConnection(): UseMutationResult<
  { readonly error?: string } & Record<string, unknown>,
  Error,
  { projectId: string | number; configType: string; body: Readonly<Record<string, unknown>> }
> {
  return useMutation({
    mutationFn: ({ projectId, configType, body }) => testConfigurationConnection(projectId, configType, body),
  });
}

/* ── API-155 ───────────────────────────────────────────────────────────── */

export function useBatchTestConfigurationConnection(): UseMutationResult<
  BatchTestResultRow[],
  Error,
  { projectId: string | number; items: readonly BatchTestConnectionItem[] }
> {
  return useMutation({
    mutationFn: ({ projectId, items }) => batchTestConfigurationConnection(projectId, items),
  });
}
