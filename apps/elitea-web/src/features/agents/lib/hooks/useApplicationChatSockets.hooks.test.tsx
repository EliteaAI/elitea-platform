import type { ReactNode } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import type { ChatHistoryMessage } from './applicationChat.types';
import type { UseApplicationChatSocketsParams } from './useApplicationChatSockets.hooks';
import { useApplicationChatSockets } from './useApplicationChatSockets.hooks';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

function setup(client: TestSocketClient, overrides: Partial<UseApplicationChatSocketsParams> = {}) {
  const onRemoteChatMessageSync = vi.fn();
  let chatHistory: ChatHistoryMessage[] = [
    { id: 'm1', role: 'assistant' },
    { id: 'm2', role: 'user' },
  ];
  const setChatHistory = vi.fn((update: (prev: ChatHistoryMessage[]) => ChatHistoryMessage[]) => {
    chatHistory = update(chatHistory);
  });

  const { rerender, unmount } = renderHook(
    (props: UseApplicationChatSocketsParams) => useApplicationChatSockets(props),
    {
      wrapper: withSocket(client),
      initialProps: {
        conversationId: undefined,
        conversationUuid: undefined,
        projectId: 'proj-1',
        onRemoteChatMessageSync,
        setChatHistory,
        ...overrides,
      },
    },
  );

  return { rerender, unmount, onRemoteChatMessageSync, setChatHistory, getChatHistory: () => chatHistory };
}

describe('useApplicationChatSockets — room membership', () => {
  it('joins chat_enter_room with conversation_uuid/project_id context once a conversationId is present', () => {
    const client = createTestSocketClient();
    setup(client, { conversationId: 5, conversationUuid: 'uuid-5', projectId: 'proj-1' });

    expect(client.getEmitted('chat_enter_room')).toHaveLength(1);
    expect(client.getEmitted('chat_enter_room')[0]?.payload).toMatchObject({
      conversation_id: '5',
      conversation_uuid: 'uuid-5',
      project_id: 'proj-1',
    });
  });

  it('does not join any room while conversationId is undefined', () => {
    const client = createTestSocketClient();
    setup(client);
    expect(client.getEmitted('chat_enter_room')).toHaveLength(0);
  });

  it('leaves the room on unmount', () => {
    const client = createTestSocketClient();
    const { unmount } = setup(client, { conversationId: 7 });
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(0);
    unmount();
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });
});

describe('useApplicationChatSockets — chat_message_sync', () => {
  it('forwards the raw payload to onRemoteChatMessageSync', () => {
    const client = createTestSocketClient();
    const { onRemoteChatMessageSync } = setup(client);

    client.simulateServerEvent('chat_message_sync', { question_id: 'q1' });

    expect(onRemoteChatMessageSync).toHaveBeenCalledWith({ question_id: 'q1' });
  });

  it('does not throw when no onRemoteChatMessageSync callback is supplied', () => {
    const client = createTestSocketClient();
    setup(client, { onRemoteChatMessageSync: undefined });

    expect(() => client.simulateServerEvent('chat_message_sync', { question_id: 'q1' })).not.toThrow();
  });

  it('always calls the LATEST onRemoteChatMessageSync after a rerender (ref, not a stale closure)', () => {
    const client = createTestSocketClient();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = setup(client, { onRemoteChatMessageSync: first });

    rerender({
      conversationId: undefined,
      conversationUuid: undefined,
      projectId: 'proj-1',
      onRemoteChatMessageSync: second,
      setChatHistory: vi.fn(),
    });

    client.simulateServerEvent('chat_message_sync', { question_id: 'q2' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ question_id: 'q2' });
  });

  it('unsubscribes on unmount', () => {
    const client = createTestSocketClient();
    const { onRemoteChatMessageSync, unmount } = setup(client);
    unmount();

    expect(() => client.simulateServerEvent('chat_message_sync', { question_id: 'q1' })).not.toThrow();
    expect(onRemoteChatMessageSync).not.toHaveBeenCalled();
  });
});

describe('useApplicationChatSockets — chat_message_delete', () => {
  it('removes the matching entry from chat history when message_group_uid is present', () => {
    const client = createTestSocketClient();
    const { getChatHistory } = setup(client);

    client.simulateServerEvent('chat_message_delete', { message_group_uid: 'm1' });

    expect(getChatHistory()).toEqual([{ id: 'm2', role: 'user' }]);
  });

  it('does not touch chat history when message_group_uid is missing', () => {
    const client = createTestSocketClient();
    const { getChatHistory, setChatHistory } = setup(client);

    client.simulateServerEvent('chat_message_delete', {});

    expect(setChatHistory).not.toHaveBeenCalled();
    expect(getChatHistory()).toHaveLength(2);
  });
});
