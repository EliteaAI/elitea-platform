/**
 * DEFECT: the "Share" menu item copied a conversation URL with no `/app`
 * basename, so the link was a hard 404 for whoever received it.
 *
 * `ConversationItem` builds the share URL as
 * `${protocol}//${host}${basename}/${projectId}/chat/${id}?...` and takes the
 * basename as a prop, defaulting to `''`. This composition root — the only
 * thing that mounts `Conversations` — never supplied it. In every deployment
 * where `vite_base_uri` is not `/`, only `/app/**` is served by the SPA, so
 * the copied link missed the mount point entirely. Development hid the
 * defect, because `import.meta.env.DEV` resolves the basename to `''` there.
 *
 * The trailing slash matters too: `vite_base_uri` is `/app/` and the URL
 * builder already adds a leading `/`, so an untrimmed value yields
 * `https://host/app//5/chat/...`.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { http, HttpResponse } from 'msw';

import type { Conversation } from '@/entities/conversation';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';
import { useSelectedProjectStore } from '@/widgets/app-shell';

import { useConversationSidebar } from './useConversationSidebar';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(baseUri: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: baseUri,
    vite_public_project_id: '1',
  };
  resetConfigForTests();
}

/**
 * The hook needs a router ancestor (`useNavigate`) and a query client. The
 * root route renders the probe, the same shape
 * `features/agents/__tests__/testUtils.tsx` uses.
 */
function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rootRoute = createRootRoute({ component: () => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/chat'] }) });
  return <RouterProvider router={router as never} />;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
  resetGeneratedClient();
  useSelectedProjectStore.setState({ project: null });
});

describe('useConversationSidebar — share-link basename', () => {
  it('passes the deployment basename down, with the trailing slash trimmed', async () => {
    vi.stubEnv('DEV', false);
    setConfig('/app/');

    const { result } = renderHook(() => useConversationSidebar(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current.conversationsProps.basename).toBe('/app');
  });

  it('passes an empty basename when the app is mounted at the root', async () => {
    vi.stubEnv('DEV', false);
    setConfig('/');

    const { result } = renderHook(() => useConversationSidebar(), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current.conversationsProps.basename).toBe('');
  });
});

/**
 * DEFECT: `Conversations` accepts `currentUserId`, and the row menu disables
 * Delete and Edit on a conversation the current user does not own. This
 * composition root — the only place that builds `conversationsProps` — never
 * set it. The guard compared `undefined` with `undefined`, so it denied
 * nothing and any project member could delete another member's conversation.
 *
 * The unit test next to the menu could not see this: it supplied both ids
 * itself. Only a test at the composition root can.
 */
describe('useConversationSidebar — current user id', () => {
  it('passes the signed-in user id down to the conversation list', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    setConfig('/app/');
    server.use(http.get('/api/v2/social/author', () => HttpResponse.json({ id: 'user-9', name: 'Signed-in User' })));

    const { result } = renderHook(() => useConversationSidebar(), { wrapper });

    await waitFor(() => expect(result.current.conversationsProps.currentUserId).toBe('user-9'));
    resetGeneratedClient();
  });
});

/**
 * A router whose `/chat` and `/chat/$conversationId` routes actually exist,
 * created ONCE and handed back so a test can assert where a delete navigated
 * — the same shape `processes/chat/ui/useCreateChatReset.test.tsx`'s
 * `makeWrapper` established. The plain `wrapper` above rebuilds its router on
 * every render, so its pathname cannot be asserted across state updates.
 */
function makeRoutedWrapper(): { Wrapper: (props: { readonly children: ReactNode }) => ReactNode; router: { navigate: (options: unknown) => Promise<void>; state: { location: { pathname: string } } } } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let render: () => ReactNode = () => null;
  // The probe renders in the ROOT route's component — like the real sidebar,
  // it must survive the `/chat` -> `/chat/$conversationId` transitions these
  // tests perform; a leaf-route probe remounts (and loses all its state) on
  // every navigation.
  const rootRoute = createRootRoute({ component: () => render() });
  const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: () => null });
  const conversationRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$conversationId', component: () => null });
  const router = createRouter({
    routeTree: rootRoute.addChildren([chatRoute, conversationRoute]),
    history: createMemoryHistory({ initialEntries: ['/chat'] }),
  });

  function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    render = () => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return <RouterProvider router={router as never} />;
  }

  return { Wrapper, router: router as never };
}

/** Selects a project (the guard every conversation API call sits behind) and covers the requests a mounted sidebar fires. */
function seedProjectSeven(): void {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  setConfig('/app/');
  useSelectedProjectStore.setState({ project: { id: '7', name: 'Project 7' } });
  server.use(
    http.get('/api/v2/social/author', () => HttpResponse.json({ id: 'user-1' })),
    http.get('/api/v2/auth/permissions/prompt_lib/7', () => HttpResponse.json([])),
  );
}

const conversation: Conversation = { id: 'c1', name: 'Old name', isPrivate: true };

/**
 * DEFECT: renaming a conversation and "Make public" were silent no-ops.
 *
 * `ConversationItem`'s rename editor and its "Make public" menu item both
 * call `onEdit` with the already-updated conversation. This composition
 * root's `onEditConversation` only did `setActiveConversation(conversation)`
 * — no PUT, and no patch of `dateGroups`/`folders`, which are what the
 * visible rows render from (`Conversations.body.tsx`). The real
 * `renameConversation` was reachable only for a NEW conversation.
 */
describe('useConversationSidebar — conversation edit persistence', () => {
  it('persists a rename via the edit API and patches the visible date groups', async () => {
    seedProjectSeven();
    const editBodies: unknown[] = [];
    server.use(
      http.put('/api/v2/elitea_core/conversation/prompt_lib/7/c1', async ({ request }) => {
        editBodies.push(await request.json());
        return HttpResponse.json({ id: 'c1', name: 'Renamed', is_private: true });
      }),
    );
    const { Wrapper } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current.conversationsProps.setDateGroups([{ name: 'Today', conversations: [conversation] }]));
    act(() => result.current.conversationsProps.onEditConversation({ ...conversation, name: 'Renamed' }));

    await waitFor(() => expect(editBodies).toEqual([{ name: 'Renamed', is_private: true }]));
    await waitFor(() => expect(result.current.conversationsProps.dateGroups[0]?.conversations[0]?.name).toBe('Renamed'));
  });

  it('persists Make public and patches the folder-held row', async () => {
    seedProjectSeven();
    const editBodies: unknown[] = [];
    server.use(
      http.put('/api/v2/elitea_core/conversation/prompt_lib/7/c1', async ({ request }) => {
        editBodies.push(await request.json());
        return HttpResponse.json({ id: 'c1', name: 'Old name', is_private: false });
      }),
    );
    const { Wrapper } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current.conversationsProps.setFolders([{ id: 'f1', name: 'Folder', conversations: [conversation] }]));
    act(() => result.current.conversationsProps.onEditConversation({ ...conversation, isPrivate: false }));

    await waitFor(() => expect(editBodies).toEqual([{ name: 'Old name', is_private: false }]));
    await waitFor(() => expect(result.current.conversationsProps.folders[0]?.conversations[0]?.isPrivate).toBe(false));
  });
});

/**
 * DEFECT: deleting a conversation left it on screen and kept the route on
 * the deleted transcript. `deleteConversation` filtered only `conversations`
 * (count-only) and `pinnedConversations`; the visible rows come from
 * `dateGroups`/`folders`, and nothing navigated off the deleted id.
 */
describe('useConversationSidebar — conversation delete', () => {
  it('drops the row from date groups and folders, and navigates the active conversation back to /chat', async () => {
    seedProjectSeven();
    server.use(http.delete('/api/v2/elitea_core/conversation/prompt_lib/7/c1', () => HttpResponse.json({})));
    const { Wrapper, router } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => {
      result.current.conversationsProps.setDateGroups([{ name: 'Today', conversations: [conversation] }]);
      result.current.conversationsProps.setFolders([{ id: 'f1', name: 'Folder', conversations: [conversation] }]);
    });
    // Make it the ACTIVE conversation, the way a user gets there: a click.
    act(() => result.current.conversationsProps.onSelectConversation(conversation));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));

    act(() => result.current.conversationsProps.onDeleteConversation(conversation));

    await waitFor(() => expect(result.current.conversationsProps.dateGroups[0]?.conversations).toEqual([]));
    expect(result.current.conversationsProps.folders[0]?.conversations).toEqual([]);
    expect(result.current.conversationsProps.selectedConversationId).toBeUndefined();
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  /**
   * DEFECT (stale row-handler): the row's Delete handler is captured by a
   * memoised `ConversationItem` reached through `useRenderConversationItem`'s
   * `useCallback([])` render-prop, so a row rendered BEFORE it was selected
   * keeps the `deleteConversation` closure that existed at that first render.
   * When `deleteConversation` decided "am I deleting the open one?" from that
   * closure's captured `activeConversation`, the answer was `undefined` — the
   * DELETE still landed and the row vanished, but the route stayed on the
   * just-deleted transcript.
   *
   * The earlier delete test cannot see this: it reads
   * `result.current.conversationsProps.onDeleteConversation` AFTER selecting,
   * so it always gets the freshest handler. This one captures the handler
   * BEFORE the click, then invokes that exact reference — the stale closure a
   * real `ConversationItem` holds — and proves the navigate-away branch still
   * fires because `deleteConversation` now reads the active conversation live.
   */
  it('navigates to /chat from a Delete handler captured BEFORE the row was selected (stale-closure repro)', async () => {
    seedProjectSeven();
    server.use(http.delete('/api/v2/elitea_core/conversation/prompt_lib/7/c1', () => HttpResponse.json({})));
    const { Wrapper, router } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => {
      result.current.conversationsProps.setDateGroups([{ name: 'Today', conversations: [conversation] }]);
      result.current.conversationsProps.setFolders([{ id: 'f1', name: 'Folder', conversations: [conversation] }]);
    });

    // Grab the Delete handler NOW, while nothing is selected — this is the
    // closure a row rendered before selection carries. A pre-fix build closes
    // over `activeConversation === undefined` here.
    const staleDelete = result.current.conversationsProps.onDeleteConversation;

    // Select it the way a user does — a click — AFTER the handler was captured.
    act(() => result.current.conversationsProps.onSelectConversation(conversation));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));

    // Invoke the STALE handler, not the current one.
    act(() => staleDelete(conversation));

    await waitFor(() => expect(result.current.conversationsProps.dateGroups[0]?.conversations).toEqual([]));
    expect(result.current.conversationsProps.folders[0]?.conversations).toEqual([]);
    expect(result.current.conversationsProps.selectedConversationId).toBeUndefined();
    // The branch a pre-fix build skipped: the route must leave the deleted id.
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
  });

  it('does not navigate away when the deleted conversation is not the active one', async () => {
    seedProjectSeven();
    server.use(http.delete('/api/v2/elitea_core/conversation/prompt_lib/7/c1', () => HttpResponse.json({})));
    const { Wrapper, router } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    const other: Conversation = { id: 'c2', name: 'Other', isPrivate: true };
    act(() => result.current.conversationsProps.setDateGroups([{ name: 'Today', conversations: [conversation, other] }]));
    act(() => result.current.conversationsProps.onSelectConversation(other));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c2'));

    act(() => result.current.conversationsProps.onDeleteConversation(conversation));

    await waitFor(() => expect(result.current.conversationsProps.dateGroups[0]?.conversations).toEqual([other]));
    expect(result.current.conversationsProps.selectedConversationId).toBe('c2');
    expect(router.state.location.pathname).toBe('/chat/c2');
  });
});

/**
 * DEFECT (stale row-handler, rename): `renameConversation` is
 * `onChangeActiveConversationName` — by name and by contract it acts on
 * whatever conversation is open WHEN IT IS CALLED. It read `activeConversation`
 * out of its own render closure instead, and listed it in the `useCallback`
 * dependency array, so correctness depended entirely on a fresh handler
 * reference reaching the row. It does not always: `Conversations` hands row
 * callbacks down through `useRenderConversationItem`'s `useCallback([])`
 * render prop into a memoised `ConversationItem`, exactly the arrangement that
 * lets a row keep the closure it was rendered with. A closure captured before
 * any selection carries `activeConversation === undefined`, and the guard turns
 * every later rename into a silent no-op — no PUT, no error, the old name
 * still on screen.
 *
 * Same repro shape as the Delete stale-closure test above: capture the handler
 * while nothing is selected, THEN select, THEN invoke that exact reference.
 */
describe('useConversationSidebar — conversation rename', () => {
  it('renames the conversation open at CALL time from a handler captured BEFORE it was selected (stale-closure repro)', async () => {
    seedProjectSeven();
    const renameBodies: unknown[] = [];
    server.use(
      http.put('/api/v2/elitea_core/conversation/prompt_lib/7/c1', async ({ request }) => {
        renameBodies.push(await request.json());
        return HttpResponse.json({ id: 'c1', name: 'Typed later', is_private: true });
      }),
    );
    const { Wrapper, router } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current.conversationsProps.setDateGroups([{ name: 'Today', conversations: [conversation] }]));

    // Grab the rename handler NOW, while nothing is selected — a pre-fix build
    // closes over `activeConversation === undefined` at this point.
    const staleRename = result.current.conversationsProps.onChangeActiveConversationName;

    act(() => result.current.conversationsProps.onSelectConversation(conversation));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/c1'));

    // Invoke the STALE reference, not the current one.
    act(() => staleRename('Typed later'));

    // A pre-fix build sends nothing at all: its guard short-circuits.
    await waitFor(() => expect(renameBodies).toEqual([{ name: 'Typed later' }]));
  });

  it('still sends nothing when no conversation is open', async () => {
    seedProjectSeven();
    const renameBodies: unknown[] = [];
    server.use(
      http.put('/api/v2/elitea_core/conversation/prompt_lib/7/c1', async ({ request }) => {
        renameBodies.push(await request.json());
        return HttpResponse.json({ id: 'c1', name: 'Nope', is_private: true });
      }),
    );
    const { Wrapper } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    act(() => result.current.conversationsProps.onChangeActiveConversationName('Nope'));

    // The live read must still fail closed — reading the ref replaced the
    // stale value, not the guard.
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(renameBodies).toEqual([]);
  });
});

/**
 * DEFECT (stale header-handler): "Create folder" carries the baseline's
 * re-entrancy guard — while a draft folder is already open, a second click is
 * a no-op rather than stacking a second draft. "Is a draft already open?" is
 * answered when the button is CLICKED, but the guard read `activeFolder` out of
 * the render closure that built the callback, so a reference captured before
 * the first draft existed answered `undefined` forever and stacked a draft on
 * every call. Two drafts in `folders` means two `FolderItem`s in edit mode, and
 * `onCreateFolder` only ever confirms `activeFolder` — the orphan stays.
 */
describe('useConversationSidebar — create-folder re-entrancy', () => {
  it('refuses a second draft from a handler captured BEFORE the first draft existed (stale-closure repro)', async () => {
    seedProjectSeven();
    const { Wrapper } = makeRoutedWrapper();
    const { result } = renderHook(() => useConversationSidebar(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    // The header button holds one reference for the life of the sidebar; a
    // pre-fix build's copy closes over `activeFolder === undefined`.
    const staleCreateFolder = result.current.conversationsProps.onClickCreateNewFolder;

    act(() => staleCreateFolder());
    await waitFor(() => expect(result.current.conversationsProps.folders.filter((folder) => folder.isNew === true)).toHaveLength(1));

    // The SAME reference again. A pre-fix build's guard still sees `undefined`
    // and stacks a second draft; the live read sees the one already open.
    act(() => staleCreateFolder());

    expect(result.current.conversationsProps.folders.filter((folder) => folder.isNew === true)).toHaveLength(1);
  });
});
