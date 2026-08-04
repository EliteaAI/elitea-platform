import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { emittedStreamId } from '../__tests__/renderWithMcpProviders';

import { useMcpAuthCheck } from './useMcpAuthCheck';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

describe('useMcpAuthCheck', () => {
  it('emits test_mcp_connection with the toolkit config on runAuthCheck()', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', values: { url: 'https://mcp.example.com' }, projectId: 9 }), {
      wrapper: withSocket(client),
    });

    act(() => result.current.runAuthCheck());

    expect(result.current.isRunning).toBe(true);
    const emitted = client.getEmitted('test_mcp_connection');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.payload).toMatchObject({
      project_id: 9,
      toolkit_config: { toolkit_id: 'tk-1', type: 'mcp', settings: { url: 'https://mcp.example.com' } },
    });
  });

  it('ignores a runAuthCheck() call while already running', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1' }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    act(() => result.current.runAuthCheck());

    expect(client.getEmitted('test_mcp_connection')).toHaveLength(1);
  });

  it('routes an mcp_authorization_required response to onMcpAuthRequired and stops running', async () => {
    const client = createTestSocketClient();
    const onMcpAuthRequired = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onMcpAuthRequired }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);

    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'mcp_authorization_required', stream_id: streamId });
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onMcpAuthRequired).toHaveBeenCalledWith(expect.objectContaining({ type: 'mcp_authorization_required' }));
  });

  it('routes a success-shaped response to onSuccess', async () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);
    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: streamId });
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onSuccess).toHaveBeenCalled();
  });

  it('routes an error-shaped response to onError with the message content, and stops running', async () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onError }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);
    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'error', stream_id: streamId, content: 'boom' });
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('ignores a message carrying a DIFFERENT stream_id (a stale/crossed response)', () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: 'someone-elses-stream' });
    });

    expect(result.current.isRunning).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // Regression test for a blocker: the socket listener used to be registered
  // for the whole component lifetime (a mount-time useEffect) instead of
  // only while a check is actively running, AND the stream-id guard failed
  // OPEN while idle (`streamIdRef.current` falsy skipped the comparison
  // entirely) — so an unrelated toolkit's `test_mcp_connection` response
  // could flip a completely idle instance's onSuccess/onMcpAuthRequired.
  it('ignores an unrelated toolkit\'s response while idle (never called runAuthCheck)', () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const onMcpAuthRequired = vi.fn();
    renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess, onMcpAuthRequired }), { wrapper: withSocket(client) });

    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: 'unrelated-toolkits-stream' });
      client.simulateServerEvent('test_mcp_connection', { type: 'mcp_authorization_required', stream_id: 'unrelated-toolkits-stream' });
      // No stream_id at all is the same "idle" shape a stray broadcast could carry.
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end' });
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onMcpAuthRequired).not.toHaveBeenCalled();
  });

  // Same class of regression, after a check has already run to completion —
  // proves the listener is actually detached (not just guarded) once this
  // instance goes back to idle, so it stays deaf to later, unrelated broadcasts.
  it('ignores an unrelated toolkit\'s response after this check has already completed', async () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);
    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: streamId });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onSuccess).toHaveBeenCalledTimes(1);

    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: 'some-other-toolkits-later-stream' });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  // Regression test for a warning: SUCCESS_MESSAGE_TYPES had been widened to
  // include 'chunk' (a mid-stream partial fragment) and 'chat_user_message'
  // (a user-echo message) — neither is a completion signal in the baseline
  // app, so either could mark a connection test "successful" prematurely.
  it.each(['chunk', 'chat_user_message'])('does NOT treat a %s message as a success signal', (type) => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);
    act(() => {
      client.simulateServerEvent('test_mcp_connection', { type, stream_id: streamId });
    });

    // Neither type completes the check — it stays running and onSuccess never fires.
    expect(result.current.isRunning).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('unsubscribes from the socket event on unmount', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1' }), { wrapper: withSocket(client) });
    unmount();
    // No direct listener-count assertion API on the double; the real coverage
    // is that a post-unmount simulateServerEvent throws nothing (no listener
    // touches stale hook state) — proven implicitly by every other test's
    // clean teardown between cases sharing the same jsdom `window`.
    expect(() => client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end' })).not.toThrow();
  });

  it('unsubscribes from the socket event on unmount mid-check (abandoned before a response arrives)', () => {
    const client = createTestSocketClient();
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() => useMcpAuthCheck({ toolkitId: 'tk-1', onSuccess }), { wrapper: withSocket(client) });

    act(() => result.current.runAuthCheck());
    const streamId = emittedStreamId(client);
    unmount();

    // A response for the in-flight stream_id arrives after unmount — the
    // now-unmounted instance must not react (no listener left attached).
    expect(() => client.simulateServerEvent('test_mcp_connection', { type: 'agent_tool_end', stream_id: streamId })).not.toThrow();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
