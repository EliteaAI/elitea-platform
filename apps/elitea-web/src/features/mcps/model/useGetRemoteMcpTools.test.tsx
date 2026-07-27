import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { server } from '../../../test/setup';

import { useGetRemoteMcpTools } from './useGetRemoteMcpTools';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

afterEach(() => {
  window.sessionStorage.clear();
  resetGeneratedClient();
});

describe('useGetRemoteMcpTools', () => {
  it('rejects immediately (no request) when a remote MCP has no url', () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const { result } = renderHook(() => useGetRemoteMcpTools({ values: { type: 'mcp', settings: {} }, onError }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.fetchTools());
    expect(onError).toHaveBeenCalledWith('MCP server URL is required');
  });

  it('fetches tools and reports them via onToolsFetched, including sid/awaitResponse plumbing', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const client = createTestSocketClient();
    const onToolsFetched = vi.fn();
    const onSuccess = vi.fn();
    let capturedBody: unknown;
    let capturedUrl = '';
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/5', async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, tools: [{ name: 'list_files' }, { name: 'read_file' }] });
      }),
    );

    const { result } = renderHook(
      () => useGetRemoteMcpTools({ values: { type: 'mcp', settings: { url: 'https://mcp.example.com' } }, projectId: 5, onToolsFetched, onSuccess }),
      { wrapper: withSocket(client) },
    );

    act(() => result.current.fetchTools());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onToolsFetched).toHaveBeenCalledWith([{ name: 'list_files' }, { name: 'read_file' }], undefined);
    expect(onSuccess).toHaveBeenCalledWith(2);
    expect(capturedUrl).toContain('await_response=true');
    expect(capturedBody).toMatchObject({ url: 'https://mcp.example.com', sid: 'test-socket-client' });
  });

  it('opens the OAuth modal when the sync response reports requires_authorization', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const client = createTestSocketClient();
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/1', () =>
        HttpResponse.json({ requires_authorization: true, response_metadata: { resource_metadata: { authorization_servers: ['https://as.example.com'] } } }),
      ),
    );

    const { result } = renderHook(() => useGetRemoteMcpTools({ values: { type: 'mcp', settings: { url: 'https://needs-auth.example.com' } } }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.fetchTools());
    await waitFor(() => expect(result.current.getModalProps().open).toBe(true));
  });

  it('surfaces a friendlier message for a 401-shaped explicit failure', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const client = createTestSocketClient();
    const onError = vi.fn();
    server.use(http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/1', () => HttpResponse.json({ success: false, error: '401 Unauthorized' })));

    const { result } = renderHook(() => useGetRemoteMcpTools({ values: { type: 'mcp', settings: { url: 'https://denied.example.com' } }, onError }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.fetchTools());
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith('Authorization failed. Please try logging in again.');
  });

  it('surfaces a network/transport failure via onError rather than throwing', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const client = createTestSocketClient();
    const onError = vi.fn();
    server.use(http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/1', () => HttpResponse.json({ error: 'server exploded' }, { status: 500 })));

    const { result } = renderHook(() => useGetRemoteMcpTools({ values: { type: 'mcp', settings: { url: 'https://five-hundred.example.com' } }, onError }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.fetchTools());
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it('works for a pre-built MCP keyed by toolkitType, without requiring a url', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const client = createTestSocketClient();
    const onToolsFetched = vi.fn();
    let capturedBody: unknown;
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/1', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, tools: [{ name: 'search_repos' }] });
      }),
    );

    const { result } = renderHook(() => useGetRemoteMcpTools({ toolkitType: 'mcp_github', onToolsFetched }), { wrapper: withSocket(client) });

    act(() => result.current.fetchTools());
    await waitFor(() => expect(onToolsFetched).toHaveBeenCalled());
    expect(capturedBody).toMatchObject({ toolkit_type: 'mcp_github' });
  });
});
