import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../../__tests__/testUtils';
import { useLoadToolkits } from './useLoadToolkits';
import type { UseLoadToolkitsParams, UseLoadToolkitsResult } from './useLoadToolkits';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

/** `useLoadToolkits` bottoms out at `useGetCurrentToolkitSchemas`, which always calls `useSocketClient()` — every test needs a socket + router + query context. */
function renderLoadToolkits(params: UseLoadToolkitsParams, projectId: string | undefined): { readonly box: { current: UseLoadToolkitsResult | undefined } } {
  const box: { current: UseLoadToolkitsResult | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useLoadToolkits(params);
    return null;
  }

  function RootComponent() {
    return (
      <SocketClientContext.Provider value={createTestSocketClient()}>
        <ProbeComponent />
      </SocketClientContext.Provider>
    );
  }

  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { box };
}

describe('useLoadToolkits', () => {
  it('resolves a page of enhanced toolkits, tags, and totalCount from the mocked network boundary', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({
          rows: [{ id: 'tk-1', name: 'my-github', type: 'github', tags: [{ id: 'github', name: 'GitHub' }] }],
          total: 1,
        }),
      ),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20 }, 'proj-1');

    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    expect(box.current?.data).toHaveLength(1);
    expect(box.current?.data?.[0]).toMatchObject({ id: 'tk-1', label: 'GitHub' });
    expect(box.current?.totalCount).toBe(1);
    expect(box.current?.tagList).toEqual([{ id: 1, name: 'GitHub', data: { type: 'github' } }]);
  });

  it('reports hasMore true only while there is a further page beyond the current one', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({ rows: [{ id: 'tk-1', name: 'x', type: 'github' }], total: 25 }),
      ),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20 }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    expect(box.current?.hasMore).toBe(true);
  });

  it('reports hasMore false once the last page is reached', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({ rows: [{ id: 'tk-1', name: 'x', type: 'github' }], total: 20 }),
      ),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20 }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    expect(box.current?.hasMore).toBe(false);
  });

  it('uses the fixed Local/Remote MCP tag list when isMCP is true', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => HttpResponse.json({ rows: [], total: 0 })),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20, isMCP: true }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    expect(box.current?.tagList).toEqual([
      { id: 1, name: 'Local', data: { type: 'local' } },
      { id: 2, name: 'Remote', data: { type: 'mcp' } },
    ]);
  });

  it('uses the per-page row tags (not the project-wide list) when authorId is set', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: {}, jira: {} })),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({ rows: [{ id: 'tk-1', name: 'x', type: 'github', tags: [{ id: 'github', name: 'GitHub' }] }], total: 1 }),
      ),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20, authorId: 'author-1' }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    // Row-derived: only the ONE tag actually present on the fetched row —
    // not the two-entry schema-derived projectWideTagList (github + jira).
    expect(box.current?.tagList).toHaveLength(1);
    expect(box.current?.tagList[0]?.name).toBe('GitHub');
  });

  it('carries a row tag through unchanged, preserving its own data.type rather than overwriting it with the tag id', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: {} })),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () =>
        HttpResponse.json({
          rows: [{ id: 'tk-1', name: 'x', type: 'github', tags: [{ id: 'github', name: 'GitHub', data: { type: 'agent' } }] }],
          total: 1,
        }),
      ),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20, authorId: 'author-1' }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    // The tag's own `data.type` ('agent') must survive unchanged — not be
    // rewritten to the tag's `id` ('github').
    expect(box.current?.tagList).toEqual([{ id: 'github', name: 'GitHub', data: { type: 'agent' } }]);
  });

  it('does not fetch while no project is selected', async () => {
    const { box } = renderLoadToolkits({ page: 0, pageSize: 20 }, undefined);
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current?.isToolkitsFetching).toBe(false);
    expect(box.current?.data).toBeUndefined();
  });

  it('refetchToolkits triggers a second network request', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})),
      http.get('/api/v2/elitea_core/tools/prompt_lib/:projectId', () => {
        requestCount += 1;
        return HttpResponse.json({ rows: [], total: 0 });
      }),
    );

    const { box } = renderLoadToolkits({ page: 0, pageSize: 20 }, 'proj-1');
    await waitFor(() => expect(box.current?.isToolkitsFetching).toBe(false));
    expect(requestCount).toBe(1);

    box.current?.refetchToolkits();

    await waitFor(() => expect(requestCount).toBe(2));
  });
});
