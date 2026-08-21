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
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { http, HttpResponse } from 'msw';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

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
