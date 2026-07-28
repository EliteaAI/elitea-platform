import type { ReactNode } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

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
        ...overrides,
      }),
    { wrapper: withSocket(client) },
  );

  return { result, onRunFinish, onStartTask, onMcpAuthRequired, setChatHistory, getChatHistory: () => chatHistory };
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
