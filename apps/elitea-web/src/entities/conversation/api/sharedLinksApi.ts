/**
 * The OWNER-FACING half of "share a conversation by link": listing the links on
 * a conversation, publishing a new one, and revoking one.
 *
 * The anonymous half — the page a link-holder actually opens — is
 * `@/shared/api/sharedChatView`, and it is a separate module on purpose: these
 * three calls ride the app's authenticated client and its re-auth behaviour,
 * and that one must not.
 *
 * Loosely typed for the same reason `./conversationApi.ts` is: no OpenAPI
 * schema exists for this resource.
 */
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';

async function fetchData<T>(url: string, options?: RequestInit): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options);
  return envelope.data;
}

/**
 * One share link, as its owner sees it.
 *
 * THERE IS NO `token` FIELD, and its absence is deliberate rather than an
 * omission: the server stores only SHA-256 of the token
 * (`migrations/shared/0100_shared_chat_links.sql`), so the plaintext exists in
 * exactly one response — the create call's — and can never be listed again.
 * A UI that re-renders a copyable URL from a listing is therefore impossible
 * here by construction, which is the point.
 */
export interface SharedChatLink {
  readonly id: number;
  readonly scope: string;
  readonly has_password: boolean;
  readonly created_by?: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly revoked_at?: string;
  readonly access_count: number;
  readonly last_accessed_at?: string;
  /** Server-derived: neither revoked nor past its expiry. */
  readonly active: boolean;
}

/** The create response, and the ONLY place a token ever appears. */
export interface SharedChatLinkCreated extends SharedChatLink {
  readonly token: string;
}

export const SHARED_CHAT_LINKS_QUERY_KEY = 'shared-chat-links';

export interface ListShareLinksParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
}

export async function listShareLinks(params: ListShareLinksParams): Promise<readonly SharedChatLink[]> {
  const { projectId, conversationId } = params;
  return fetchData<readonly SharedChatLink[]>(`/elitea_core/shared_chat_links/prompt_lib/${String(projectId)}/${String(conversationId)}`);
}

export function useShareLinksQuery(params: ListShareLinksParams, enabled: boolean): UseQueryResult<readonly SharedChatLink[], unknown> {
  return useQuery({
    queryKey: [SHARED_CHAT_LINKS_QUERY_KEY, String(params.projectId), String(params.conversationId)],
    queryFn: () => listShareLinks(params),
    enabled,
  });
}

/**
 * `expiry` is one of the four the server admits. There is no "never": the
 * server refuses an unknown value rather than defaulting, so an option this
 * client invents becomes a 400 rather than a silently long-lived link.
 */
export type ShareLinkExpiry = '1h' | '1d' | '7d' | '30d';

export interface CreateShareLinkParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
  readonly expiry: ShareLinkExpiry;
  readonly scope?: 'all' | 'partial';
  readonly password?: string;
  readonly message_group_ids?: readonly number[];
}

export async function createShareLink(params: CreateShareLinkParams): Promise<SharedChatLinkCreated> {
  const { projectId, conversationId, ...body } = params;
  return fetchData<SharedChatLinkCreated>(`/elitea_core/shared_chat_links/prompt_lib/${String(projectId)}/${String(conversationId)}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function useCreateShareLinkMutation(): UseMutationResult<SharedChatLinkCreated, unknown, CreateShareLinkParams> {
  return useMutation({ mutationFn: createShareLink });
}

export interface RevokeShareLinkParams {
  readonly projectId: string | number;
  readonly conversationId: string | number;
  readonly linkId: number;
}

/**
 * Revoke is addressed by the link's ROW ID, not by its token — the client no
 * longer holds the token once the create response is gone, and the server
 * could not match a plaintext token against a stored hash-only row anyway.
 *
 * `eliteaFetch` is called directly rather than through `fetchData`: the route
 * answers 204 with no body, so unwrapping a `{data}` envelope would fail on
 * success.
 */
export async function revokeShareLink(params: RevokeShareLinkParams): Promise<void> {
  const { projectId, conversationId, linkId } = params;
  await eliteaFetch<unknown>(`/elitea_core/shared_chat_link/prompt_lib/${String(projectId)}/${String(conversationId)}/${String(linkId)}`, { method: 'DELETE' });
}

export function useRevokeShareLinkMutation(): UseMutationResult<void, unknown, RevokeShareLinkParams> {
  return useMutation({ mutationFn: revokeShareLink });
}
