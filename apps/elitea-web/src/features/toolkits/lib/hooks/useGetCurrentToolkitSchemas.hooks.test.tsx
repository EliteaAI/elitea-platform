import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import type { TestSocketClient } from '@/shared/api/socket/testing';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../../__tests__/testUtils';
import { useGetCurrentToolkitSchemas } from './useGetCurrentToolkitSchemas.hooks';
import type { UseGetCurrentToolkitSchemasParams, UseGetCurrentToolkitSchemasResult } from './useGetCurrentToolkitSchemas.hooks';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

/**
 * Mounts `useGetCurrentToolkitSchemas` under a real router root context AND
 * a real socket client — this hook always calls `useSocketClient()`
 * internally (the `mcp_status` refetch listener runs regardless of `isMCP`;
 * only the refetch itself is gated), so every test needs both, not just the
 * mcp_status-specific ones.
 */
function renderToolkitSchemas(
  params: UseGetCurrentToolkitSchemasParams,
  client: TestSocketClient,
  projectId: string | undefined,
): { readonly box: { current: UseGetCurrentToolkitSchemasResult | undefined } } {
  const box: { current: UseGetCurrentToolkitSchemasResult | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useGetCurrentToolkitSchemas(params);
    return null;
  }

  function RootComponent() {
    return (
      <SocketClientContext.Provider value={client}>
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

describe('useGetCurrentToolkitSchemas', () => {
  it('is disabled and returns undefined data while no project is selected', async () => {
    const { box } = renderToolkitSchemas({}, createTestSocketClient(), undefined);
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current?.toolkitSchemas).toBeUndefined();
    expect(box.current?.isFetching).toBe(false);
  });

  it('resolves the toolkit-type schema map from the real (mocked) network boundary', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({ github: { metadata: { label: 'GitHub' } } }),
      ),
    );

    const { box } = renderToolkitSchemas({}, createTestSocketClient(), 'proj-1');
    await waitFor(() => expect(box.current?.isFetching).toBe(false));
    expect(box.current?.toolkitSchemas).toEqual({ github: { metadata: { label: 'GitHub' } } });
  });

  it('does not fetch when skip is true', async () => {
    const { box } = renderToolkitSchemas({ skip: true }, createTestSocketClient(), 'proj-1');
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current?.isFetching).toBe(false);
    expect(box.current?.toolkitSchemas).toBeUndefined();
  });

  it('refetches on an mcp_status socket event when isMCP is true', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => {
        requestCount += 1;
        return HttpResponse.json({ github: {} });
      }),
    );

    const client = createTestSocketClient();
    const { box } = renderToolkitSchemas({ isMCP: true }, client, 'proj-1');

    await waitFor(() => expect(box.current?.isFetching).toBe(false));
    expect(requestCount).toBe(1);

    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: true });

    await waitFor(() => expect(requestCount).toBe(2));
  });

  it('does not refetch on mcp_status when isMCP is false', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => {
        requestCount += 1;
        return HttpResponse.json({ github: {} });
      }),
    );

    const client = createTestSocketClient();
    const { box } = renderToolkitSchemas({ isMCP: false }, client, 'proj-1');

    await waitFor(() => expect(box.current?.isFetching).toBe(false));
    expect(requestCount).toBe(1);

    client.simulateServerEvent('mcp_status', { type: 'mcp', connected: true });

    // Give any (incorrect) refetch a chance to fire, then assert it didn't.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestCount).toBe(1);
  });
});
