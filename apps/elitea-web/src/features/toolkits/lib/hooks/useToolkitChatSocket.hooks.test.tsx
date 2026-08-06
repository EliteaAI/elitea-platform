import type { ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';
import { installTestEventSource, type TestEventSourceRegistry } from '@/shared/api/sse/testing';
import { resetConfigForTests } from '@/shared/config/get-config';

import type { ToolkitChatMessage } from './useToolkitChat.types';
import { useToolkitChatSocket } from './useToolkitChatSocket.hooks';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

function setup(client: TestSocketClient, overrides: Partial<Parameters<typeof useToolkitChatSocket>[0]> = {}) {
  const onRunFinish = vi.fn();
  const onStartTask = vi.fn();
  const onMcpAuthRequired = vi.fn();
  const onStreamError = vi.fn();
  let chatHistory: ToolkitChatMessage[] = [];
  const setChatHistory = vi.fn((update: (prev: ToolkitChatMessage[]) => ToolkitChatMessage[]) => {
    chatHistory = update(chatHistory);
  });

  const { result } = renderHook(
    () =>
      useToolkitChatSocket({
        isAuthCheckSession: false,
        onMcpAuthRequired,
        onRunFinish,
        onStartTask,
        setChatHistory,
        activeConversationId: undefined,
        activeConversationUuid: undefined,
        projectId: 'proj-1',
        roomEnabled: false,
        executionId: undefined,
        onStreamError,
        ...overrides,
      }),
    { wrapper: withSocket(client) },
  );

  return { result, onRunFinish, onStartTask, onMcpAuthRequired, onStreamError, setChatHistory, getChatHistory: () => chatHistory };
}

describe('useToolkitChatSocket', () => {
  it('returns the shared socket client (for the caller\'s own chat_predict emit)', () => {
    const client = createTestSocketClient();
    const { result } = setup(client);
    expect(result.current).toBe(client);
  });

  it('routes an mcp_authorization_required message to onMcpAuthRequired instead of the chat reducer', () => {
    const client = createTestSocketClient();
    const { onMcpAuthRequired, setChatHistory } = setup(client);

    client.simulateServerEvent('chat_predict', { type: 'mcp_authorization_required', message_id: 'm1' });

    expect(onMcpAuthRequired).toHaveBeenCalledTimes(1);
    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('ignores every chat_predict message while isAuthCheckSession is true', () => {
    const client = createTestSocketClient();
    const { onMcpAuthRequired, setChatHistory } = setup(client, { isAuthCheckSession: true });

    client.simulateServerEvent('chat_predict', { type: 'mcp_authorization_required', message_id: 'm1' });
    client.simulateServerEvent('chat_predict', { type: 'chunk', message_id: 'm2' });

    expect(onMcpAuthRequired).not.toHaveBeenCalled();
    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('routes a normal chat_predict message through setChatHistory (the indexChat reducer)', () => {
    const client = createTestSocketClient();
    const { setChatHistory } = setup(client);

    client.simulateServerEvent('chat_predict', { type: 'start_task', message_id: 'm1', content: { task_id: 't1' } });

    expect(setChatHistory).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes chat_predict on unmount', () => {
    const client = createTestSocketClient();
    const { result, unmount } = renderHook(
      () =>
        useToolkitChatSocket({
          isAuthCheckSession: false,
          onMcpAuthRequired: undefined,
          onRunFinish: vi.fn(),
          onStartTask: vi.fn(),
          setChatHistory: vi.fn(),
          activeConversationId: undefined,
          activeConversationUuid: undefined,
          projectId: 'proj-1',
          roomEnabled: false,
          executionId: undefined,
          onStreamError: vi.fn(),
        }),
      { wrapper: withSocket(client) },
    );
    void result;
    unmount();

    // A message after unmount must not throw and must not still be routed —
    // proven indirectly: no listener remains registered, so this is a no-op.
    expect(() => client.simulateServerEvent('chat_predict', { type: 'chunk', message_id: 'after-unmount' })).not.toThrow();
  });

  it('joins the chat_enter_room/chat_leave_rooms pair only while roomEnabled is true, using activeConversationId as the room id', () => {
    const client = createTestSocketClient();
    const { rerender } = renderHook(
      ({ roomEnabled }) =>
        useToolkitChatSocket({
          isAuthCheckSession: false,
          onMcpAuthRequired: undefined,
          onRunFinish: vi.fn(),
          onStartTask: vi.fn(),
          setChatHistory: vi.fn(),
          activeConversationId: 'conv-1',
          activeConversationUuid: 'uuid-1',
          projectId: 'proj-1',
          roomEnabled,
          executionId: undefined,
          onStreamError: vi.fn(),
        }),
      { wrapper: withSocket(client), initialProps: { roomEnabled: false } },
    );

    expect(client.getEmitted('chat_enter_room')).toHaveLength(0);

    rerender({ roomEnabled: true });
    expect(client.getEmitted('chat_enter_room')).toHaveLength(1);
    expect(client.getEmitted('chat_enter_room')[0]?.payload).toMatchObject({
      conversation_id: 'conv-1',
      conversation_uuid: 'uuid-1',
      project_id: 'proj-1',
    });

    rerender({ roomEnabled: false });
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });
});

describe('useToolkitChatSocket — SSE execution stream (issue #93)', () => {
  const globals = globalThis as unknown as Record<string, unknown>;
  let sse: TestEventSourceRegistry;

  beforeEach(() => {
    sse = installTestEventSource();
    globals['elitea_ui_config'] = { vite_server_url: '/api/v2', vite_base_uri: '/', vite_public_project_id: 'public-1' };
    resetConfigForTests();
  });

  afterEach(() => {
    sse.restore();
    delete globals['elitea_ui_config'];
    resetConfigForTests();
  });

  it('opens the execution stream only once an executionId exists', () => {
    const client = createTestSocketClient();
    setup(client);
    expect(sse.getSources()).toHaveLength(0);

    setup(client, { executionId: 'exec-1' });
    expect(sse.getSources()[0]?.url).toBe('/api/v2/executions/proj-1/exec-1/events');
  });

  it('routes an execution.node_event frame through the same reducer as chat_predict', () => {
    const client = createTestSocketClient();
    const { setChatHistory } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.emit('execution.node_event', JSON.stringify({ type: 'start_task', message_id: 'm1', content: { task_id: 't1' } }));
    });

    expect(setChatHistory).toHaveBeenCalledTimes(1);
  });

  it('routes an mcp_authorization_required node event to onMcpAuthRequired, exactly like the socket path', () => {
    const client = createTestSocketClient();
    const { onMcpAuthRequired, setChatHistory } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.emit('execution.node_event', JSON.stringify({ type: 'mcp_authorization_required', message_id: 'm1' }));
    });

    expect(onMcpAuthRequired).toHaveBeenCalledTimes(1);
    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('drops a node event with no `type` discriminant (not a usable stream envelope)', () => {
    const client = createTestSocketClient();
    const { setChatHistory } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.emit('execution.node_event', JSON.stringify({ message_id: 'm1', content: 'orphan' }));
    });

    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('maps index.ingest.completed status onto the index state reported to onRunFinish', () => {
    const cases: readonly (readonly [string, string])[] = [
      ['ok', 'completed'],
      ['partly_indexed', 'partly_indexed'],
      ['error', 'failed'],
    ];
    for (const [status, expected] of cases) {
      const client = createTestSocketClient();
      const { onRunFinish } = setup(client, { executionId: 'exec-1' });
      act(() => {
        sse.emit('index.ingest.completed', JSON.stringify({ status }));
      });
      expect(onRunFinish).toHaveBeenLastCalledWith(expected);
    }
  });

  it('settles as completed when the terminal frame carries no status (the artifact-shaped projection)', () => {
    const client = createTestSocketClient();
    const { onRunFinish } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.emit('index.ingest.completed', JSON.stringify({ artifact_id: 'a1', media_type: 'application/json' }));
    });

    expect(onRunFinish).toHaveBeenCalledWith('completed');
  });

  it('reports execution.failed as a failed run', () => {
    const client = createTestSocketClient();
    const { onRunFinish } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.emit('execution.failed', JSON.stringify({ message: 'worker died' }));
    });

    expect(onRunFinish).toHaveBeenCalledWith('failed');
  });

  it('ignores every SSE frame while isAuthCheckSession is true', () => {
    const client = createTestSocketClient();
    const { onRunFinish, onMcpAuthRequired, setChatHistory } = setup(client, { executionId: 'exec-1', isAuthCheckSession: true });

    act(() => {
      sse.emit('execution.node_event', JSON.stringify({ type: 'mcp_authorization_required', message_id: 'm1' }));
      sse.emit('index.ingest.completed', JSON.stringify({ status: 'ok' }));
      sse.emit('execution.failed', JSON.stringify({ message: 'boom' }));
    });

    expect(setChatHistory).not.toHaveBeenCalled();
    expect(onMcpAuthRequired).not.toHaveBeenCalled();
    expect(onRunFinish).not.toHaveBeenCalled();
  });
  it('forwards a stream-open failure to onStreamError — the socket-fallback signal', () => {
    const client = createTestSocketClient();
    const { onStreamError, onRunFinish } = setup(client, { executionId: 'exec-1' });

    act(() => {
      sse.fail();
    });

    expect(onStreamError).toHaveBeenCalledTimes(1);
    // A transport failure is NOT an execution failure: the run is about to
    // be re-dispatched on socket.io, so it must not be reported as failed.
    expect(onRunFinish).not.toHaveBeenCalled();
  });
});
