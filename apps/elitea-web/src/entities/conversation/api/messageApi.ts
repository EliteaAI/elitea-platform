/**
 * Hand-written REST layer for the 3 message-scoped endpoints of
 * `chat.api.js` (unit C1) — `messageList`, `deleteMessageFromConversation`,
 * `deleteAllMessagesFromConversation`. Same handwritten-manifest rationale
 * as `./conversationApi.ts`'s module doc (read that first).
 *
 * `messageList`'s baseline (`chat.api.js:24-74`) is an RTK Query
 * infinite-list endpoint with its own `serializeQueryArgs`/`merge`/
 * `forceRefetch` — "load page N, append onto the running list, unless
 * `page` is 0/1 in which case replace it". That merge-into-a-running-array
 * behaviour is page-state orchestration (the chat message LIST a future
 * C2-C6 unit owns), not REST-layer or entity-domain concern; this module
 * exposes the plain, page-scoped fetcher + a `useQuery` wrapper and leaves
 * the pagination-merge orchestration to the caller — same scoping precedent
 * `entities/application-form/model/mutations.ts`'s own doc comment
 * establishes for stripping page/feature orchestration out of an
 * entities-layer port ("page/feature orchestration ... entities/ may not
 * import features/pages").
 */
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/* ── messageList — GET elitea_core/messages/prompt_lib/{projectId}/{conversationId} ── */
/* manifest: conversation.messageList */

export interface MessageListParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
  readonly page: number;
  readonly pageSize?: number;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** Loosely typed — the persisted message-group shape is `entities/message`'s concern (`no-sideways-entities` forbids importing its wire types here); either a bare array or `{rows,total}`, matching `chat.api.js:34-44`'s own `transformResponse` branch. */
export type MessageListResponse = readonly unknown[] | { readonly rows: readonly unknown[]; readonly total?: number; readonly [key: string]: unknown };

function messageListQueryString(params: MessageListParams): string {
  const pageSize = params.pageSize ?? 10;
  const query = new URLSearchParams({ ...params.params, limit: String(pageSize), offset: String(params.page * pageSize) });
  return `?${query.toString()}`;
}

export async function messageList(params: MessageListParams, signal?: AbortSignal): Promise<MessageListResponse> {
  const url = `/elitea_core/messages/prompt_lib/${String(params.projectId)}/${String(params.conversationId)}${messageListQueryString(params)}`;
  return fetchData<MessageListResponse>(url, signal ? { signal } : {});
}

export function useMessageListQuery(params: MessageListParams, options: { enabled?: boolean } = {}): UseQueryResult<MessageListResponse> {
  return useQuery({
    queryKey: ['conversation', 'messageList', params.projectId, params.conversationId, params.page, params.pageSize, params.params],
    queryFn: ({ signal }) => messageList(params, signal),
    enabled: options.enabled ?? true,
  });
}

/* ── deleteMessageFromConversation — DELETE elitea_core/message/prompt_lib/{projectId}/{id} ── */
/* manifest: conversation.deleteMessage */

export interface DeleteMessageFromConversationParams {
  readonly projectId: string | number;
  readonly id: string | number;
  /** Not sent — kept only so callers can invalidate the right conversation's cache (baseline: `chat.api.js:83-86`'s `invalidatesTags`). */
  readonly conversationId?: string | number;
}

export async function deleteMessageFromConversation(params: DeleteMessageFromConversationParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/message/prompt_lib/${String(params.projectId)}/${String(params.id)}`, { method: 'DELETE' });
}

export function useDeleteMessageFromConversationMutation(): UseMutationResult<unknown, unknown, DeleteMessageFromConversationParams> {
  return useMutation({ mutationFn: deleteMessageFromConversation });
}

/* ── deleteAllMessagesFromConversation — DELETE elitea_core/messages/prompt_lib/{projectId}/{conversationId} ── */
/* manifest: conversation.deleteAllMessages */

export interface DeleteAllMessagesFromConversationParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
}

export async function deleteAllMessagesFromConversation(params: DeleteAllMessagesFromConversationParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/messages/prompt_lib/${String(params.projectId)}/${String(params.conversationId)}`, { method: 'DELETE' });
}

export function useDeleteAllMessagesFromConversationMutation(): UseMutationResult<unknown, unknown, DeleteAllMessagesFromConversationParams> {
  return useMutation({ mutationFn: deleteAllMessagesFromConversation });
}
