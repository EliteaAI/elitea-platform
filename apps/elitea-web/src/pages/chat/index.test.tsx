/**
 * DEFECT: a notification deep link opened an empty new chat.
 *
 * `features/notifications/lib/routes.ts`'s `chatHref` builds every
 * `chat_user_added`/`chat_user_mentioned` link as
 * `/{projectId}/chat?conversation=<id>&message_id=<id>`, and the project
 * splat route strips the project segment, so the click lands on
 * `/chat?conversation=<id>&message_id=<id>` — a URL with NO path param.
 * `ChatPage` read the conversation only from `useParams`, so it saw
 * `undefined`, `useChatPageData` disabled its queries, and the user got a
 * blank new chat instead of the conversation they were mentioned in.
 *
 * The second half was dead as well: `chatSessionStore.messageIdToView` is
 * read by `ChatMessageList` and `useHighlightUserMessage`, but the only two
 * writers in the app both passed `''`, so `message_id` never scrolled
 * anywhere.
 *
 * These cases mount the real route tree, because the pure resolver
 * (`entities/conversation`'s `resolveConversationIdFromUrl`) already had a
 * green test while having zero production callers — which is exactly how
 * this shipped.
 */
import type { ReactNode } from 'react';

import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppProviders } from '@/app/providers/AppProviders';
import { useChatSessionStore } from '@/entities/conversation';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import ChatPage from './index';

/*
 * The conversation-detail request is the observable proof that the page
 * resolved a conversation at all: `useChatPageData` disables both the detail
 * and the message queries while the id is undefined. Recorded through MSW
 * rather than by substituting `ChatBox` — R-M1 allows only the network
 * boundary to be doubled.
 */
const detailRequests: string[] = [];

const BASE = '/api/v2';
const PROJECT = '77';
const CONVERSATION = '5';

function handlers() {
  return [
    http.get(`${BASE}/social/author`, () => HttpResponse.json({ id: 'u1', name: 'Ada', avatar: '', personal_project_id: PROJECT })),
    http.get(`${BASE}/elitea_core/conversation/prompt_lib/${PROJECT}/${CONVERSATION}`, ({ request }) => {
      detailRequests.push(request.url);
      return HttpResponse.json({ id: CONVERSATION, name: 'A conversation', participants: [] });
    }),
    http.get(`${BASE}/elitea_core/messages/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
      HttpResponse.json({ items: [], total: 0, page: 0, page_size: 50, total_pages: 1 }),
    ),
    // `ChatBox` reads the model catalogue on mount; answered so the run is
    // not full of unhandled-request noise.
    http.get(`${BASE}/configurations/models/${PROJECT}`, () => HttpResponse.json({ items: [] })),
  ];
}

/** The two real chat routes, so `navigate({to:'/chat/$conversationId'})` resolves the same way it does in the app. */
function renderAt(initialEntry: string) {
  const rootRoute = createRootRoute({ component: (): ReactNode => <Outlet /> });
  const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: ChatPage });
  const conversationRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$conversationId', component: ChatPage });
  const router = createRouter({
    routeTree: rootRoute.addChildren([chatRoute, conversationRoute]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  render(
    <AppProviders>
      <RouterProvider router={router as never} />
    </AppProviders>,
  );
  return router;
}

beforeEach(() => {
  detailRequests.length = 0;
  useChatSessionStore.setState({ messageIdToView: '' });
  configureGeneratedClient({ baseUrl: BASE });
  server.use(...handlers());
});

afterEach(() => {
  resetGeneratedClient();
});

describe('ChatPage deep links', () => {
  it('opens the conversation named by `?conversation=`, not a blank new chat', async () => {
    renderAt(`/chat?conversation=${CONVERSATION}`);

    // A generous timeout: the detail request only starts after the author
    // query resolves, so this is two sequential round trips on a loaded
    // machine, not one.
    await waitFor(() => expect(detailRequests).toHaveLength(1), { timeout: 5000 });
  });

  it('canonicalises the URL to /chat/<id> and drops the consumed param, keeping message_id', async () => {
    const router = renderAt(`/chat?conversation=${CONVERSATION}&message_id=m1`);

    await waitFor(() => expect(router.state.location.pathname).toBe(`/chat/${CONVERSATION}`), { timeout: 5000 });
    const search = router.state.location.search as { readonly conversation?: string; readonly message_id?: string };
    expect(search.conversation).toBeUndefined();
    expect(search.message_id).toBe('m1');
  });

  it('publishes `?message_id=` into the store the message list scrolls by', async () => {
    renderAt(`/chat?conversation=${CONVERSATION}&message_id=m1`);

    await waitFor(() => expect(useChatSessionStore.getState().messageIdToView).toBe('m1'), { timeout: 5000 });
  });

  it('leaves a plain /chat URL as a new conversation', async () => {
    const router = renderAt('/chat');

    await waitFor(() => {
      expect(router.state.status).toBe('idle');
    });
    expect(router.state.location.pathname).toBe('/chat');
    expect(detailRequests).toHaveLength(0);
  });
});
