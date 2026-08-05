/**
 * Hand-written REST layer for the conversation-scoped subset of
 * `apps/elitea-ui/src/[fsd]/features/chat/api/chat.api.js` (unit C1) — create/
 * edit/delete/details/select/unselect/regenerate/stopChatTask. No OpenAPI
 * schema documents any `/elitea_core/conversation(s)/...` path (orval's
 * generated client never picked these routes up), but every route below IS
 * a real, wired Go route — confirmed directly against
 * `services/elitea-main/internal/api/router.go`. Per R-A5, every fetcher
 * below goes through `eliteaFetch` (the same transport every generated hook
 * uses) and this unit reports 6 new `source:"handwritten"` manifest entries
 * for merge into `endpoints.manifest.json` (see the unit report — this file
 * does NOT edit that file itself).
 *
 * `conversationDetails` and `stopChatTask` are DELIBERATELY NOT new manifest
 * entries: both routes are byte-identical to two already-landed handwritten
 * entries this same backend domain already produced —
 * `toolkits.getIndexHistoryConversationDetails` (`GET /elitea_core/
 * conversation/prompt_lib/{projectId}/{conversationId}`,
 * `features/toolkits/indexes/api/indexesApi.ts`) and `pipelines.stopLlmTask`
 * (`DELETE /elitea_core/task/prompt_lib/{projectId}/{taskId}`,
 * `features/pipelines/api/aiAssistantPredict.ts`). This module reuses the
 * exact same URL patterns rather than importing those two functions
 * directly (`entities/` may not import `features/`, `no-upward-from-entities`)
 * — the unit report asks for `entities/conversation` to be added to both
 * pre-existing entries' `usedBy` array instead of a new, duplicate entry.
 *
 * Response shapes are loosely typed (`ConversationWire`'s catch-all index
 * signature) for the same reason `features/toolkits/indexes/api/
 * indexesApi.ts`'s own `ConversationDetailsWire` is: no schema exists to
 * assert a narrower shape against.
 */
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

import type { ChatParticipantWire } from '../lib/wire';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/** A persisted conversation row — loosely typed, no OpenAPI schema exists for this resource (see module doc). */
export interface ConversationWire {
  readonly id: string | number;
  readonly uuid?: string;
  readonly name: string;
  readonly is_private?: boolean;
  readonly folder_id?: string | number;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly participants?: readonly ChatParticipantWire[];
  readonly [key: string]: unknown;
}

/* ── conversationCreate — POST elitea_core/conversations/prompt_lib/{projectId} ── */
/* manifest: conversation.create */

export interface ConversationCreateParams {
  readonly projectId: string | number;
  readonly name: string;
  readonly is_private: boolean;
  readonly participants?: readonly unknown[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export async function conversationCreate(params: ConversationCreateParams): Promise<ConversationWire> {
  const { projectId, ...body } = params;
  return fetchData<ConversationWire>(`/elitea_core/conversations/prompt_lib/${String(projectId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useConversationCreateMutation(): UseMutationResult<ConversationWire, unknown, ConversationCreateParams> {
  return useMutation({ mutationFn: conversationCreate });
}

/* ── conversationEdit — PUT elitea_core/conversation/prompt_lib/{projectId}/{id} ── */
/* manifest: conversation.edit */

export interface ConversationEditParams {
  readonly projectId: string | number;
  readonly id: string | number;
  readonly name?: string;
  readonly is_private?: boolean;
  readonly [key: string]: unknown;
}

export async function conversationEdit(params: ConversationEditParams): Promise<ConversationWire> {
  const { projectId, id, ...body } = params;
  return fetchData<ConversationWire>(`/elitea_core/conversation/prompt_lib/${String(projectId)}/${String(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useConversationEditMutation(): UseMutationResult<ConversationWire, unknown, ConversationEditParams> {
  return useMutation({ mutationFn: conversationEdit });
}

/* ── deleteConversation — DELETE elitea_core/conversation/prompt_lib/{projectId}/{id} ── */
/* manifest: conversation.delete */

export interface DeleteConversationParams {
  readonly projectId: string | number;
  readonly id: string | number;
}

export async function deleteConversation(params: DeleteConversationParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/conversation/prompt_lib/${String(params.projectId)}/${String(params.id)}`, { method: 'DELETE' });
}

export function useDeleteConversationMutation(): UseMutationResult<unknown, unknown, DeleteConversationParams> {
  return useMutation({ mutationFn: deleteConversation });
}

/* ── conversationDetails — GET elitea_core/conversation/prompt_lib/{projectId}/{id} ── */
/* Reuses `toolkits.getIndexHistoryConversationDetails`'s route — no new manifest entry (see module doc). */

export interface ConversationDetailsParams {
  readonly projectId: string | number;
  readonly id: string | number;
  readonly messages_offset?: number;
  readonly messages_limit?: number;
  readonly sort_order?: string;
}

function detailsQueryString(params: ConversationDetailsParams): string {
  const query = new URLSearchParams();
  if (params.messages_offset !== undefined) query.set('messages_offset', String(params.messages_offset));
  if (params.messages_limit !== undefined) query.set('messages_limit', String(params.messages_limit));
  if (params.sort_order !== undefined) query.set('sort_order', params.sort_order);
  const qs = query.toString();
  return qs ? `?${qs}` : '';
}

export async function conversationDetails(params: ConversationDetailsParams, signal?: AbortSignal): Promise<ConversationWire> {
  const url = `/elitea_core/conversation/prompt_lib/${String(params.projectId)}/${String(params.id)}${detailsQueryString(params)}`;
  return fetchData<ConversationWire>(url, signal ? { signal } : {});
}

export function useConversationDetailsQuery(params: ConversationDetailsParams, options: { enabled?: boolean } = {}): UseQueryResult<ConversationWire> {
  return useQuery({
    queryKey: ['conversation', 'details', params.projectId, params.id, params.messages_offset, params.messages_limit, params.sort_order],
    queryFn: ({ signal }) => conversationDetails(params, signal),
    enabled: options.enabled ?? true,
  });
}

/* ── selectConversation — POST elitea_core/select_conversation/prompt_lib/{projectId}/{conversationId} ── */
/* manifest: conversation.select */

export interface SelectConversationParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
}

export async function selectConversation(params: SelectConversationParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/select_conversation/prompt_lib/${String(params.projectId)}/${String(params.conversationId)}`, {
    method: 'POST',
    body: JSON.stringify({}),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useSelectConversationMutation(): UseMutationResult<unknown, unknown, SelectConversationParams> {
  return useMutation({ mutationFn: selectConversation });
}

/* ── unselectConversation — DELETE elitea_core/select_conversation/prompt_lib/{projectId} ── */
/* manifest: conversation.unselect */

export interface UnselectConversationParams {
  readonly projectId: string | number;
}

export async function unselectConversation(params: UnselectConversationParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/select_conversation/prompt_lib/${String(params.projectId)}`, { method: 'DELETE' });
}

export function useUnselectConversationMutation(): UseMutationResult<unknown, unknown, UnselectConversationParams> {
  return useMutation({ mutationFn: unselectConversation });
}

/* ── regenerate — POST elitea_core/regenerate/prompt_lib/{projectId}/{id} ── */
/* manifest: conversation.regenerate */

export interface RegenerateParams {
  readonly projectId: string | number;
  readonly id: string | number;
  readonly [key: string]: unknown;
}

export async function regenerate(params: RegenerateParams): Promise<unknown> {
  const { projectId, id, ...body } = params;
  return fetchData<unknown>(`/elitea_core/regenerate/prompt_lib/${String(projectId)}/${String(id)}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useRegenerateMutation(): UseMutationResult<unknown, unknown, RegenerateParams> {
  return useMutation({ mutationFn: regenerate });
}

/* ── stopChatTask — DELETE elitea_core/task/prompt_lib/{projectId}/{taskId} ── */
/* Reuses `pipelines.stopLlmTask`'s route — no new manifest entry (see module doc). Baseline param name is `messageGroupUuid`; same route. */

export interface StopChatTaskParams {
  readonly projectId: string | number;
  readonly messageGroupUuid: string;
}

export async function stopChatTask(params: StopChatTaskParams): Promise<unknown> {
  return fetchData<unknown>(`/elitea_core/task/prompt_lib/${String(params.projectId)}/${params.messageGroupUuid}`, { method: 'DELETE' });
}

export function useStopChatTaskMutation(): UseMutationResult<unknown, unknown, StopChatTaskParams> {
  return useMutation({ mutationFn: stopChatTask });
}
