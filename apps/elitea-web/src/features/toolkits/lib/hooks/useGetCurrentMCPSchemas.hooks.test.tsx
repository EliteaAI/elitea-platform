import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderHookWithRouterAndProject } from '../../__tests__/testUtils';
import { useGetCurrentMCPSchemas } from './useGetCurrentMCPSchemas.hooks';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useGetCurrentMCPSchemas', () => {
  it('is disabled (no fetch) when isMCP is false, even with a project selected', async () => {
    const { getResult } = renderHookWithRouterAndProject(() => useGetCurrentMCPSchemas({ isMCP: false }), 'proj-1');
    await waitFor(() => expect(getResult()).toBeDefined());
    expect(getResult().isFetching).toBe(false);
    expect(getResult().mcpSchemas).toBeUndefined();
  });

  it('is disabled while no project is selected, even with isMCP true', async () => {
    const { getResult } = renderHookWithRouterAndProject(() => useGetCurrentMCPSchemas({ isMCP: true }), undefined);
    await waitFor(() => expect(getResult()).toBeDefined());
    expect(getResult().isFetching).toBe(false);
  });

  it('resolves ONLY the mcp-flavoured subset of the toolkit-type schema map when isMCP is true and a project is selected (R1 regression guard)', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({
          mcp: { metadata: { label: 'Remote MCP' } },
          github: {},
          jira: {},
          my_local_mcp: { type: 'mcp' },
          another_server_mcp: {},
        }),
      ),
    );

    const { getResult } = renderHookWithRouterAndProject(() => useGetCurrentMCPSchemas({ isMCP: true }), 'proj-1');
    await waitFor(() => expect(getResult().isFetching).toBe(false));
    // Real, disclosed gap (see the source file's own doc comment): the
    // generated endpoint has no server-side mcp-only filter, so this hook
    // approximates it client-side (key `'mcp'`, `type: 'mcp'`, or a key
    // ending in `'mcp'`) — ordinary, non-mcp-shaped toolkit types (github,
    // jira) must NOT leak into the result, unlike the full unfiltered map
    // `useGetCurrentToolkitSchemas` returns.
    expect(getResult().mcpSchemas).toEqual({
      mcp: { metadata: { label: 'Remote MCP' } },
      my_local_mcp: { type: 'mcp' },
      another_server_mcp: {},
    });
  });

  it('exposes an imperative refetch', async () => {
    let requestCount = 0;
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () => {
        requestCount += 1;
        return HttpResponse.json({});
      }),
    );

    const { getResult } = renderHookWithRouterAndProject(() => useGetCurrentMCPSchemas({ isMCP: true }), 'proj-1');
    await waitFor(() => expect(getResult().isFetching).toBe(false));
    expect(requestCount).toBe(1);

    getResult().refetch();

    await waitFor(() => expect(requestCount).toBe(2));
  });
});
