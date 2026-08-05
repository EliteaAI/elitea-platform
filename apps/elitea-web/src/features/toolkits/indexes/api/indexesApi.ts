/**
 * TanStack Query port of `apps/elitea-ui/src/[fsd]/features/toolkits/
 * indexes/api/indexesApi.js` (unit A4a's RTK Query endpoints). Query-key
 * based caching replaces `providesTags`; explicit `invalidateQueries` calls
 * replace `invalidatesTags` — this app has no Redux/RTK Query anywhere
 * (spec §2.3: "TanStack Query + zustand"), matching the established pattern
 * in e.g. `features/credentials/api/useConfigurations.ts`.
 *
 * `updateIndexSchedule`/`getIndexSchedule`/`deleteIndexItem` additionally
 * write into `../model/indexesStore.ts`'s `toolkitScheduler` map on
 * success — the TanStack-era replacement for the baseline slice's
 * `getIndexSchedule.matchFulfilled`/`deleteIndexItem.matchFulfilled`
 * `extraReducers` matchers (see that file's own doc comment).
 *
 * Also carries `getIndexHistoryConversationDetails` — a LOCAL, indexes-
 * scoped duplicate of `entities/run-history`'s `getRunHistoryDetails`
 * endpoint (`apps/elitea-ui/src/[fsd]/entities/run-history/api/
 * runHistoryApi.js:38-46`). `entities/run-history` does not exist anywhere
 * in this app yet (confirmed: no `src/entities/run-history` directory in
 * this worktree, and it is not named as an A4a dependency in this unit's
 * brief — only `useToolkitChat`/`ToolkitChatModesEnum` (A4b) and `features/
 * mcps` (A5) are). It is also not indexes-specific (agents/pipelines run
 * history need the identical endpoint), so — same class of decision as
 * `useSelectedProjectId.ts` — this is a scoped-down local duplicate (one
 * endpoint of the baseline entity's three) rather than an invented
 * cross-domain promotion this sub-unit has no mandate to make.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import type { MessageGroupWire } from '@/entities/message';

import type { ConversationParticipantWire } from '../lib/helpers/conversationHistory.local';
import type { IndexRow, ScheduleEntry } from '../model/indexesStore';
import { useIndexesStore } from '../model/indexesStore';

/**
 * `fetchData<T>` resolves to orval's enveloped shape (`{data: T, status,
 * headers}`) — matching `features/credentials/api/configurations.ts`'s own
 * documented reason for this one-place unwrap.
 */
async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

const INDEXES_QUERY_ROOT = ['toolkits', 'indexes'] as const;
const INDEX_SCHEDULE_QUERY_ROOT = ['toolkits', 'indexSchedule'] as const;

/* ── getIndexesList — GET elitea_core/index_meta/prompt_lib/{projectId}/{toolkitId} ── */

export interface GetIndexesListParams {
  readonly toolkitId: string | undefined;
  readonly projectId: string | number | undefined;
}

export async function getIndexesList(params: GetIndexesListParams, signal?: AbortSignal): Promise<IndexRow[]> {
  const { toolkitId, projectId } = params;
  return fetchData<IndexRow[]>(`/elitea_core/index_meta/prompt_lib/${String(projectId)}/${String(toolkitId)}`, signal ? { signal } : {});
}

export function useIndexesListQuery(params: GetIndexesListParams): UseQueryResult<IndexRow[]> {
  const { toolkitId, projectId } = params;
  return useQuery({
    queryKey: [...INDEXES_QUERY_ROOT, 'list', toolkitId, projectId],
    queryFn: ({ signal }) => getIndexesList(params, signal),
    enabled: toolkitId !== undefined && projectId !== undefined,
  });
}

/* ── deleteIndexItem — DELETE elitea_core/index_meta/prompt_lib/{projectId}/{toolkitId}/{indexId} ── */

export interface DeleteIndexItemParams {
  readonly projectId: string | number;
  readonly toolkitId: string;
  readonly indexId: string;
  readonly indexName: string;
}

export async function deleteIndexItem(params: DeleteIndexItemParams): Promise<unknown> {
  const { projectId, toolkitId, indexId } = params;
  return fetchData<unknown>(`/elitea_core/index_meta/prompt_lib/${String(projectId)}/${toolkitId}/${indexId}`, {
    method: 'DELETE',
    body: JSON.stringify({ is_hidden: true }),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useDeleteIndexItemMutation(): UseMutationResult<unknown, Error, DeleteIndexItemParams> {
  const queryClient = useQueryClient();
  const removeToolkitSchedule = useIndexesStore((state) => state.removeToolkitSchedule);
  return useMutation({
    mutationFn: deleteIndexItem,
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: INDEXES_QUERY_ROOT });
      removeToolkitSchedule(variables.indexName);
    },
  });
}

/* ── stopIndexingItem — DELETE elitea_core/index_cancel/prompt_lib/{projectId}/{toolkitId}/{indexName}/{taskId} ── */

export interface StopIndexingItemParams {
  readonly projectId: string | number;
  readonly toolkitId: string;
  readonly indexName: string;
  readonly taskId: string;
}

export async function stopIndexingItem(params: StopIndexingItemParams): Promise<unknown> {
  const { projectId, toolkitId, indexName, taskId } = params;
  return fetchData<unknown>(
    `/elitea_core/index_cancel/prompt_lib/${String(projectId)}/${toolkitId}/${indexName}/${taskId}`,
    { method: 'DELETE' },
  );
}

export function useStopIndexingItemMutation(): UseMutationResult<unknown, Error, StopIndexingItemParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: stopIndexingItem,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: INDEXES_QUERY_ROOT }),
  });
}

/* ── updateIndexSchedule — PATCH elitea_core/index_meta/prompt_lib/{projectId}/{toolkitId}/{indexName} ── */

export interface UpdateIndexScheduleParams {
  readonly projectId: string | number;
  readonly toolkitId: string;
  readonly indexName: string;
  readonly timezone: string;
  readonly cron?: string;
  readonly enabled?: boolean;
  readonly credentials?: unknown;
}

export async function updateIndexSchedule(params: UpdateIndexScheduleParams): Promise<unknown> {
  const { projectId, toolkitId, indexName, ...body } = params;
  return fetchData<unknown>(`/elitea_core/index_meta/prompt_lib/${String(projectId)}/${toolkitId}/${indexName}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useUpdateIndexScheduleMutation(): UseMutationResult<unknown, Error, UpdateIndexScheduleParams> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateIndexSchedule,
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({ queryKey: [...INDEX_SCHEDULE_QUERY_ROOT, variables.toolkitId] }),
  });
}

/* ── getIndexSchedule — GET elitea_core/tool/prompt_lib/{projectId}/{toolkitId} ── */

export interface GetIndexScheduleParams {
  readonly projectId: string | number | undefined;
  readonly toolkitId: string | undefined;
}

interface ToolDetailWire {
  readonly meta?: { readonly indexes_meta?: Readonly<Record<string, ScheduleEntry>> };
}

export async function getIndexSchedule(params: GetIndexScheduleParams, signal?: AbortSignal): Promise<ToolDetailWire> {
  const { projectId, toolkitId } = params;
  return fetchData<ToolDetailWire>(`/elitea_core/tool/prompt_lib/${String(projectId)}/${String(toolkitId)}`, signal ? { signal } : {});
}

export function useIndexScheduleQuery(params: GetIndexScheduleParams): UseQueryResult<ToolDetailWire> {
  const { projectId, toolkitId } = params;
  const setToolkitScheduler = useIndexesStore((state) => state.setToolkitScheduler);
  return useQuery({
    queryKey: [...INDEX_SCHEDULE_QUERY_ROOT, toolkitId, projectId],
    queryFn: async ({ signal }) => {
      const result = await getIndexSchedule(params, signal);
      setToolkitScheduler(result.meta?.indexes_meta ?? {});
      return result;
    },
    enabled: projectId !== undefined && toolkitId !== undefined,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

/* ── getIndexHistoryConversationDetails — GET elitea_core/conversation/prompt_lib/{projectId}/{conversationId} ── */
/* Local duplicate of entities/run-history's getRunHistoryDetails — see file header. */

export interface GetIndexHistoryConversationDetailsParams {
  readonly projectId: string | number | undefined;
  readonly conversationId: string | undefined;
}

/**
 * Loosely typed — the persisted conversation shape is `entities/
 * conversation`'s concern, not re-derived here — EXCEPT `message_groups`/
 * `participants`, typed against `entities/message`'s real wire types so
 * `../lib/helpers/conversationHistory.local.ts` (which normalizes exactly
 * those two fields) can consume this without a cast.
 */
export interface ConversationDetailsWire {
  readonly id?: string | number;
  readonly message_groups?: readonly MessageGroupWire[];
  readonly participants?: readonly ConversationParticipantWire[];
  readonly [key: string]: unknown;
}

export async function getIndexHistoryConversationDetails(
  params: GetIndexHistoryConversationDetailsParams,
  signal?: AbortSignal,
): Promise<ConversationDetailsWire> {
  const { projectId, conversationId } = params;
  return fetchData<ConversationDetailsWire>(
    `/elitea_core/conversation/prompt_lib/${String(projectId)}/${String(conversationId)}`,
    signal ? { signal } : {},
  );
}

export function useIndexHistoryConversationDetailsQuery(
  params: GetIndexHistoryConversationDetailsParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ConversationDetailsWire> {
  const { projectId, conversationId } = params;
  return useQuery({
    queryKey: [...INDEXES_QUERY_ROOT, 'historyConversation', projectId, conversationId],
    queryFn: ({ signal }) => getIndexHistoryConversationDetails(params, signal),
    enabled: (options.enabled ?? true) && projectId !== undefined && conversationId !== undefined,
  });
}
