/**
 * `useChatPageData` had NO test at all — which is how the defect in issue #132
 * shipped: both API calls returned 200 and the page still showed "Something
 * went wrong", because the message-list envelope (`{items,total,page,…}`) was
 * handed to `ChatBox` as `message_groups` and `convertMessagesToChatHistory`
 * spread a non-iterable. Nothing in the unit suite looked at the composed
 * `activeConversation` at all.
 *
 * These cases pin the composition against the THREE body shapes this API
 * really uses, so swapping one for another at the call site fails here rather
 * than at a user's deep link.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useChatPageData } from './useChatPageData';

const BASE = '/api/v2';
const PROJECT = '77';
const CONVERSATION = '5';

const MESSAGE_ROWS = [{ id: 'm1' }, { id: 'm2' }];

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Stands in for the route error boundary the real deep link hit. A render-time
 * throw has to be caught by a boundary, not by `result.error` — React 19
 * re-throws it out of the renderHook call otherwise.
 */
class CatchBoundary extends Component<{ readonly onError: (error: unknown) => void; readonly children: ReactNode }, { readonly failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Author with a personal project — the projectId source when no project is selected. */
function authorHandler() {
  return http.get(`${BASE}/social/author`, () =>
    HttpResponse.json({ id: 'u1', name: 'Ada', avatar: '', personal_project_id: PROJECT }),
  );
}

function detailsHandler() {
  return http.get(`${BASE}/elitea_core/conversation/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
    HttpResponse.json({ id: CONVERSATION, name: 'A conversation', participants: [{ id: 'p1' }], meta: { steps_limit: 12 } }),
  );
}

function messagesHandler(body: object) {
  return http.get(`${BASE}/elitea_core/messages/prompt_lib/${PROJECT}/${CONVERSATION}`, () => HttpResponse.json(body));
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useChatPageData', () => {
  it.each([
    ['the {items,total,page,page_size,total_pages} envelope this endpoint really returns', { items: MESSAGE_ROWS, total: 2, page: 1, page_size: 50, total_pages: 1 }],
    ['a {rows,total} envelope', { rows: MESSAGE_ROWS, total: 2 }],
    ['a bare array', MESSAGE_ROWS],
  ])('composes message_groups as a real array from %s', async (_label, body) => {
    server.use(authorHandler(), detailsHandler(), messagesHandler(body));

    const { result } = renderHook(() => useChatPageData({ conversationId: CONVERSATION }), { wrapper });

    await waitFor(() => {
      expect(result.current.activeConversation?.id).toBe(CONVERSATION);
    });
    const groups = result.current.activeConversation?.message_groups;
    // `[...groups]` is what convertMessagesToChatHistory does; the bug was that
    // this was the envelope OBJECT, which is not iterable.
    expect(Array.isArray(groups)).toBe(true);
    expect([...(groups ?? [])]).toHaveLength(2);
    expect(result.current.projectId).toBe(PROJECT);
    expect(result.current.user).toStrictEqual({ id: 'u1', name: 'Ada', avatar: '' });
    expect(result.current.activeConversation?.meta).toStrictEqual({ steps_limit: 12 });
  });

  it('adapts Main current-schema rows into stable message UUIDs and reply linkage', async () => {
    server.use(
      authorHandler(),
      detailsHandler(),
      messagesHandler({
        items: [
          {
            id: '41',
            uid: '00000000-0000-4000-8000-000000000041',
            role: 'user',
            content: 'question',
            metadata: { interaction_uuid: 'interaction-1' },
            created_at: '2026-08-27T18:00:00Z',
          },
          {
            id: '42',
            uid: '00000000-0000-4000-8000-000000000042',
            role: 'assistant',
            content: 'answer',
            metadata: { thread_id: 'thread-1' },
            created_at: '2026-08-27T18:00:01Z',
          },
        ],
      }),
    );

    const { result } = renderHook(() => useChatPageData({ conversationId: CONVERSATION }), { wrapper });

    await waitFor(() => expect(result.current.activeConversation?.message_groups).toHaveLength(2));
    const groups = result.current.activeConversation?.message_groups ?? [];
    expect(groups[0]).toMatchObject({
      id: '41',
      uuid: '00000000-0000-4000-8000-000000000041',
      role: 'user',
      meta: { interaction_uuid: 'interaction-1' },
    });
    expect(groups[1]).toMatchObject({
      id: '42',
      uuid: '00000000-0000-4000-8000-000000000042',
      role: 'assistant',
      reply_to_id: '41',
      question_id: '41',
      meta: { thread_id: 'thread-1' },
    });
  });

  it('reports a brand-new list envelope loudly instead of rendering it as an empty conversation', async () => {
    server.use(authorHandler(), detailsHandler(), messagesHandler({ results: MESSAGE_ROWS, count: 2 }));
    const caught: unknown[] = [];

    renderHook(() => useChatPageData({ conversationId: CONVERSATION }), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <CatchBoundary onError={(error) => caught.push(error)}>{children}</CatchBoundary>
        </QueryClientProvider>
      ),
    });

    // Under DEV/test the unwrap throws, so an unknown envelope is a loud
    // failure rather than a page quietly showing an empty conversation — the
    // whole point of issue 132. In production the same path logs and renders
    // an empty list instead (see shared/api/unwrap.test.ts).
    await waitFor(() => {
      expect(caught[0]).toBeInstanceOf(TypeError);
    });
    expect((caught[0] as Error).message).toMatch(/unrecognised list response shape/);
  });

  it('is a new-chat shell with no conversation id, without touching the conversation endpoints', async () => {
    server.use(authorHandler());

    const { result } = renderHook(() => useChatPageData({ conversationId: undefined }), { wrapper });

    await waitFor(() => {
      expect(result.current.projectId).toBe(PROJECT);
    });
    expect(result.current.activeConversation).toStrictEqual({ isNew: true });
    expect(result.current.isLoadingConversation).toBe(false);
  });
});
