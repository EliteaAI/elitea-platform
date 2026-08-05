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
import { useToolkitIconKind } from './useToolkitIconKind.hooks';
import type { UseToolkitIconKindResult } from './useToolkitIconKind.hooks';

/**
 * Mounted under a real router root context + real socket client (this
 * hook's `useGetCurrentToolkitSchemas` dependency always calls
 * `useSocketClient()`, per that hook's own test's doc comment) and the
 * real generated `useListToolkits` MSW-mocked at the network boundary —
 * R-M1 forbids `vi.mock()`ing the internal hook chain directly.
 */
function renderIconKind(type: string | undefined, isMCP: boolean, projectId: string | undefined): { readonly box: { current: UseToolkitIconKindResult | undefined } } {
  const box: { current: UseToolkitIconKindResult | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useToolkitIconKind(type, isMCP);
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

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useToolkitIconKind', () => {
  it('returns undefined iconKind/label for an undefined type', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    const { box } = renderIconKind(undefined, false, 'proj-1');
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current).toEqual({ iconKind: undefined, label: undefined });
  });

  it('resolves the MCP Remote category for type "mcp" when isMCP is true', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    const { box } = renderIconKind('mcp', true, 'proj-1');
    await waitFor(() => expect(box.current?.iconKind).toBe('toolkit'));
    expect(box.current?.label).toBe('Remote');
  });

  it('resolves the MCP Local category for a discovered MCP server type when isMCP is true', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));
    const { box } = renderIconKind('my_local_mcp', true, 'proj-1');
    await waitFor(() => expect(box.current?.iconKind).toBe('toolkit'));
    expect(box.current?.label).toBe('Local');
  });

  it('resolves the generic toolkit iconKind for a non-application, non-MCP type, using the real (mocked) schema catalogue', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));
    const { box } = renderIconKind('github', false, 'proj-1');
    await waitFor(() => expect(box.current?.label).toBe('GitHub'));
    expect(box.current?.iconKind).toBe('toolkit');
  });
});
