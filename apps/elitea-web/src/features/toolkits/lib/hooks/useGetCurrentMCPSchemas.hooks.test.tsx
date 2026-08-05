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

  it('resolves the full (unfiltered) toolkit-type schema map when isMCP is true and a project is selected', async () => {
    server.use(
      http.get('/api/v2/elitea_core/toolkits/prompt_lib/:projectId', () =>
        HttpResponse.json({ mcp: { metadata: { label: 'Remote MCP' } }, github: {} }),
      ),
    );

    const { getResult } = renderHookWithRouterAndProject(() => useGetCurrentMCPSchemas({ isMCP: true }), 'proj-1');
    await waitFor(() => expect(getResult().isFetching).toBe(false));
    // Real, disclosed gap (see the source file's own doc comment): the
    // generated endpoint has no server-side mcp-only filter, so this
    // returns the SAME full map `useGetCurrentToolkitSchemas` would.
    expect(getResult().mcpSchemas).toEqual({ mcp: { metadata: { label: 'Remote MCP' } }, github: {} });
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
