/**
 * The support assistant's API adapter.
 *
 * Ported from `@eliteaai/elitea-assistant`'s `src/api/adapter.api.ts`, which is a
 * bare `fetch` wrapper carrying its own `Authorization` header and
 * `credentials: 'include'` — the shape an EMBEDDABLE widget needs, because it
 * cannot assume anything about the host application's HTTP layer.
 *
 * Inside this app that assumption is available, so every JSON call goes through
 * `eliteaFetch` instead: one place that resolves the API origin, attaches the
 * session, unwraps the envelope, and classifies failures. Re-implementing any of
 * that here is how a widget acquires a second, subtly different notion of "am I
 * signed in" from the app it is mounted in.
 *
 * `uploadFile` IS GONE with the attachment surface it served — see
 * `../components/chat/MessageInput.tsx` for why this platform's start contract
 * cannot carry an attachment to the agent, and why an upload that works and is
 * never read is worse than no upload. Its removal also means this file needs no
 * `XMLHttpRequest`, so R-A4's "XHR lives only in shared/api/upload.ts" holds
 * without an exception being carved for this widget.
 */
import { eliteaFetch } from '@/shared/api/generated/mutator';

import type {
  TChatAPI,
  TConversationListItem,
  TConversationsResponse,
  TRawConversation,
} from '../lib/types';

/** The subrouter this widget talks to, relative to the app's API base. */
const BASE = '/support_assistant';

/**
 * `eliteaFetch` RESOLVES TO THE ENVELOPE, NOT THE BODY.
 *
 * Its return is `{ data, status, headers } as T` — the `as T` is a cast, so
 * `eliteaFetch<TAssistantConfig>(…)` type-checks perfectly and hands back an
 * object whose `enabled` is `undefined`, with a 200 and nothing in the console.
 * That is not hypothetical here: it is exactly the defect
 * `../../api/supportAssistantConfigApi.test.tsx` was written to pin, on this
 * very endpoint, and the same shape as issue #132.
 *
 * Every call in this file therefore goes through `unwrap()`, which names the
 * envelope in the type and returns `.data`. Adding a call that uses
 * `eliteaFetch` directly reintroduces the bug silently.
 */
async function unwrap<T>(url: string, options?: RequestInit, transport?: { readonly background?: boolean }): Promise<T> {
  const envelope = await eliteaFetch<{ data: T }>(url, options ?? {}, transport ?? {});
  return envelope.data;
}

/**
 * `startTurn`'s answer — the agent-execution start body, of which this widget
 * reads one field.
 */
export interface TSupportTurnStarted {
  readonly events_url?: string;
  readonly execution_id?: string;
  readonly task_id?: string;
}

/** One question, with the page context that was collected alongside it. */
export interface TSupportTurnRequest {
  readonly content: string;
  readonly question_id: string;
  readonly support_assistant_context?: Record<string, unknown> | undefined;
}

/** The adapter, widened with the two calls the socket transport used to cover. */
export type TSupportApi = TChatAPI & {
  startTurn: (conversationUuid: string, request: TSupportTurnRequest) => Promise<TSupportTurnStarted>;
};

export const createSupportApi = (): TSupportApi => ({

  getConversations: () => unwrap<TConversationsResponse>(`${BASE}/conversations/`),

  getConversation: (conversationId: string) =>
    unwrap<TRawConversation>(`${BASE}/conversation/${encodeURIComponent(conversationId)}`),

  createConversation: () =>
    unwrap<TConversationListItem>(`${BASE}/conversations/`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    }),



  /**
   * Start one turn. This is the REST call that replaces the widget's
   * `support_predict` socket emit; the answer names the SSE stream the frames
   * arrive on (`vendor/lib/hooks/stream.hook.ts`).
   */
  startTurn: (conversationUuid: string, request: TSupportTurnRequest) =>
    unwrap<TSupportTurnStarted>(`${BASE}/predict/${encodeURIComponent(conversationUuid)}`, {
      method: 'POST',
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' },
    }),

});
