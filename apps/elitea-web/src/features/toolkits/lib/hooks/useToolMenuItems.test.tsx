import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../../__tests__/testUtils';
import { useToolMenuItems } from './useToolMenuItems';
import type { UseToolMenuItemsParams, UseToolMenuItemsResult } from './useToolMenuItems';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function renderToolMenuItems(params: UseToolMenuItemsParams): { readonly box: { current: UseToolMenuItemsResult | undefined } } {
  const box: { current: UseToolMenuItemsResult | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useToolMenuItems(params);
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
    context: { auth: { getSelectedProjectId: () => 'proj-1' } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { box };
}

describe('useToolMenuItems', () => {
  it('excludes mcp-shaped, hidden, and agent/application-labelled entries, and adds Custom for the non-MCP/non-application case', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({
          github: { metadata: { label: 'GitHub' } },
          mcp: { metadata: { label: 'MCP' } },
          hidden_tool: { metadata: { label: 'Hidden', hidden: true } },
          application: { metadata: { label: 'Agent' } },
        }),
      ),
    );

    const { box } = renderToolMenuItems({});

    await waitFor(() => expect(box.current?.isFetchingToolkitTypes).toBe(false));
    const keys = box.current?.toolMenuItems.map((item) => item.key);
    expect(keys).toContain('github');
    expect(keys).toContain('custom');
    expect(keys).not.toContain('mcp');
    expect(keys).not.toContain('hidden_tool');
    expect(keys).not.toContain('application');
  });

  it('does not add a Custom entry for isMCP', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({})));

    const { box } = renderToolMenuItems({ isMCP: true });

    await waitFor(() => expect(box.current?.isFetchingToolkitTypes).toBe(false));
    expect(box.current?.toolMenuItems.map((item) => item.key)).not.toContain('custom');
  });

  it('does not add a Custom entry for isApplication', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub', application: true } } })),
    );

    const { box } = renderToolMenuItems({ isApplication: true });

    await waitFor(() => expect(box.current?.isFetchingToolkitTypes).toBe(false));
    const keys = box.current?.toolMenuItems.map((item) => item.key);
    expect(keys).toContain('github');
    expect(keys).not.toContain('custom');
  });

  it('wires onAddTool into each entry as onClick, called with the entry key and the resolved schema map', async () => {
    server.use(http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => HttpResponse.json({ github: { metadata: { label: 'GitHub' } } })));

    const onAddToolInner = vi.fn();
    const onAddTool = vi.fn<NonNullable<UseToolMenuItemsParams['onAddTool']>>().mockReturnValue(onAddToolInner);
    const { box } = renderToolMenuItems({ onAddTool });

    await waitFor(() => expect(box.current?.isFetchingToolkitTypes).toBe(false));
    const github = box.current?.toolMenuItems.find((item) => item.key === 'github');
    github?.onClick();

    expect(onAddTool).toHaveBeenCalledWith('github', expect.anything());
    const githubCalls = onAddTool.mock.calls.filter(([key]) => key === 'github');
    const [, schemaMapArg] = githubCalls.at(-1) ?? [];
    expect(schemaMapArg).toHaveProperty('github');
    expect(onAddToolInner).toHaveBeenCalledTimes(1);
  });
});
