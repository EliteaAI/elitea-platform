import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { getAccessToken } from '../lib/storage';
import { emittedStreamId } from '../__tests__/renderWithMcpProviders';

import { useMcpLogin } from './useMcpLogin';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

function stopPropagationEvent() {
  return { stopPropagation: vi.fn() };
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('useMcpLogin', () => {
  it('starts logged out and not running for a fresh remote MCP', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: { type: 'mcp', settings: { url: 'https://mcp.example.com' } } }), {
      wrapper: withSocket(client),
    });
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it('onLogin runs the socket connection check by default (no authConfig override)', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: { id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } } }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.onLogin(stopPropagationEvent()));

    expect(result.current.isRunning).toBe(true);
    expect(client.getEmitted('test_mcp_connection')).toHaveLength(1);
  });

  it('a successful header-based-auth connection check marks the server verified and flips isLoggedIn', async () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useMcpLogin({ values: { id: 'tk-1', type: 'mcp', settings: { url: 'https://header-auth.example.com' } }, onSuccess }),
      { wrapper: withSocket(client) },
    );

    act(() => result.current.onLogin(stopPropagationEvent()));
    const streamId = emittedStreamId(client);

    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: streamId });
    });

    await waitFor(() => expect(result.current.isLoggedIn).toBe(true));
    expect(getAccessToken('https://header-auth.example.com')).toBe('__connection_verified__');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('opens the OAuth modal when the server requires authorization', async () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: { id: 'tk-1', type: 'mcp', settings: { url: 'https://oauth-required.example.com' } } }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.onLogin(stopPropagationEvent()));
    const streamId = emittedStreamId(client);

    act(() => {
      client.simulateServerEvent('test_mcp_connection', {
        type: 'mcp_authorization_required',
        stream_id: streamId,
        response_metadata: { resource_metadata: { authorization_servers: ['https://as.example.com'] } },
      });
    });

    await waitFor(() => expect(result.current.modalProps.open).toBe(true));
  });

  it('delegates to authConfig.onLogin instead of the socket check when provided', () => {
    const client = createTestSocketClient();
    const injectedOnLogin = vi.fn();
    const { result } = renderHook(() => useMcpLogin({ values: {}, authConfig: { onLogin: injectedOnLogin } }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.onLogin(stopPropagationEvent()));

    expect(injectedOnLogin).toHaveBeenCalledTimes(1);
    expect(client.getEmitted('test_mcp_connection')).toHaveLength(0);
  });

  it('isRunning reflects an injected authConfig.isRunning even when the socket check is idle', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: {}, authConfig: { isRunning: true } }), { wrapper: withSocket(client) });
    expect(result.current.isRunning).toBe(true);
  });

  it('stopPropagation stops event bubbling', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: {} }), { wrapper: withSocket(client) });
    const event = stopPropagationEvent();
    result.current.stopPropagation(event);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('modalProps.toolkitType is set for a pre-built MCP and derives login status from toolkitType, not URL', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpLogin({ values: { type: 'mcp_github' } }), { wrapper: withSocket(client) });
    expect(result.current.modalProps.toolkitType).toBe('mcp_github');
  });
});
