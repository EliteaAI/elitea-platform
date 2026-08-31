/**
 * The ANONYMOUS half of "share a conversation by link".
 *
 * # Why this is not `eliteaFetch`
 *
 * Every other REST module in this app calls `eliteaFetch`, which routes
 * through the app's shared `HttpClient` — the one configured with
 * `reauthenticate`. On a 401 that client opens the re-auth popup and replays
 * the request (`shared/api/http.ts`, behaviour 2).
 *
 * That is exactly wrong here. This page exists for visitors who are NOT signed
 * in, and its 401 is not a session failure: it is the server saying "this link
 * is password protected". Routing it through the re-auth client would show a
 * login popup to someone who has no account, and the SPA this feature is
 * ported from had to special-case the path inside its auth layer to stop
 * precisely that.
 *
 * This module does not special-case anything. It builds its own client with NO
 * `reauthenticate` callback — the same construction `routes/auth-callback.tsx`
 * already uses for its session probe, and the mechanism `http.ts` documents for
 * "callers that must NOT trigger re-auth". A path-matching exemption inside the
 * shared client would be a second, weaker copy of the routing table; a client
 * that was never given the capability cannot exercise it.
 */
import { createHttpClient, type HttpFailure } from '@/shared/api/http';
import { getConfig } from '@/shared/config';

/** One part of a shared message: text/canvas content, or a named attachment. */
interface SharedChatItem {
  readonly type: string;
  readonly content?: string;
  /**
   * Name and type only. The server serves no attachment BYTES to anonymous
   * callers and emits no bucket or object key, so there is nothing to link to
   * and nothing about the deployment's storage layout to disclose.
   */
  readonly attachment?: {
    readonly name: string;
    readonly attachment_type?: string;
  };
}

/**
 * One message group in a shared transcript.
 *
 * `id` is an ORDINAL within the response (0, 1, 2 …), not the database's
 * message-group id — the server deliberately emits no real identifier. Use it
 * as a React key and for nothing else.
 */
export interface SharedChatMessage {
  readonly id: number;
  readonly author_type: string;
  readonly author_name?: string;
  readonly participant_type?: string;
  readonly participant_agent_type?: string;
  readonly created_at: string;
  readonly is_error: boolean;
  readonly items: readonly SharedChatItem[];
}

interface SharedChatConversation {
  readonly conversation_name: string;
  readonly expires_at: string;
  readonly messages: readonly SharedChatMessage[];
}

/**
 * What the page can be in. Four states, and the two refusals are deliberately
 * NOT distinguished any further than the server distinguishes them: an unknown,
 * a revoked and an expired token all come back as the same 404, so this client
 * has nothing finer to report and must not invent it.
 */
export type SharedChatViewResult =
  | { readonly status: 'ok'; readonly conversation: SharedChatConversation }
  | { readonly status: 'locked' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'error' };

function anonymousClient(): ReturnType<typeof createHttpClient> | undefined {
  const config = getConfig();
  if (config.status !== 'ok') return undefined;
  // No `reauthenticate`: see the module doc. `credentials` still follows the
  // client default so the unlock grant cookie rides the subsequent view.
  return createHttpClient({ baseUrl: config.config.vite_server_url });
}

function statusOf(error: HttpFailure): number | undefined {
  return error.kind === 'http' || error.kind === 'auth' ? error.status : undefined;
}

export async function fetchSharedConversation(token: string): Promise<SharedChatViewResult> {
  const client = anonymousClient();
  if (client === undefined) return { status: 'error' };
  const result = await client.get<SharedChatConversation>(`/elitea_core/shared_chat_view/prompt_lib/${encodeURIComponent(token)}`);
  if (result.ok) return { status: 'ok', conversation: result.data };
  const status = statusOf(result.error);
  if (status === 401) return { status: 'locked' };
  if (status === 404) return { status: 'unavailable' };
  return { status: 'error' };
}

export type SharedChatUnlockResult = 'ok' | 'rejected' | 'unavailable' | 'error';

/**
 * Exchanges a password for the grant cookie the view reads.
 *
 * A wrong password and a link that does not exist BOTH answer 403 — the server
 * refuses to say which, so that a guesser cannot use this endpoint to discover
 * which tokens are real. This function preserves that: `'rejected'` covers both,
 * and the page shows one message for it.
 */
export async function unlockSharedConversation(token: string, password: string): Promise<SharedChatUnlockResult> {
  const client = anonymousClient();
  if (client === undefined) return 'error';
  const result = await client.post<unknown>(`/elitea_core/shared_chat_view_unlock/prompt_lib/${encodeURIComponent(token)}/unlock`, {
    body: { password },
  });
  if (result.ok) return 'ok';
  const status = statusOf(result.error);
  if (status === 403) return 'rejected';
  if (status === 404) return 'unavailable';
  return 'error';
}
