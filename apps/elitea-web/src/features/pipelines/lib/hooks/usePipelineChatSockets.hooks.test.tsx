import type { ReactNode } from 'react';

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { usePipelineChatSockets } from './usePipelineChatSockets.hooks';
import type { ChatHistoryMessage } from './pipelineChat.types';

function withSocket(client: TestSocketClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>;
  };
}

describe('usePipelineChatSockets', () => {
  it('joins the conversation room via chat_enter_room when a conversationId is present', () => {
    const client = createTestSocketClient();
    renderHook(
      () =>
        usePipelineChatSockets({
          conversationId: 7,
          conversationUuid: 'uuid-7',
          projectId: 'p1',
          setChatHistory: () => {},
        }),
      { wrapper: withSocket(client) },
    );

    expect(client.getEmitted('chat_enter_room')).toEqual([
      { event: 'chat_enter_room', payload: { conversation_id: '7', conversation_uuid: 'uuid-7', project_id: 'p1' } },
    ]);
  });

  it('leaves the room on unmount', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(
      () =>
        usePipelineChatSockets({
          conversationId: 7,
          conversationUuid: 'uuid-7',
          projectId: 'p1',
          setChatHistory: () => {},
        }),
      { wrapper: withSocket(client) },
    );

    unmount();
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });

  it('forwards a chat_message_sync event to onRemoteChatMessageSync', () => {
    const client = createTestSocketClient();
    const onRemoteChatMessageSync = vi.fn();
    renderHook(
      () =>
        usePipelineChatSockets({
          conversationId: 7,
          conversationUuid: 'uuid-7',
          projectId: 'p1',
          onRemoteChatMessageSync,
          setChatHistory: () => {},
        }),
      { wrapper: withSocket(client) },
    );

    client.simulateServerEvent('chat_message_sync', { id: 'm1', is_streaming: false });
    expect(onRemoteChatMessageSync).toHaveBeenCalledWith({ id: 'm1', is_streaming: false });
  });

  it('removes a message from chat history on chat_message_delete', () => {
    const client = createTestSocketClient();
    let history: ChatHistoryMessage[] = [
      { id: 'm1', role: 'user' },
      { id: 'm2', role: 'assistant' },
    ];
    const setChatHistory = vi.fn((update: (prev: ChatHistoryMessage[]) => ChatHistoryMessage[]) => {
      history = update(history);
    });
    renderHook(
      () =>
        usePipelineChatSockets({
          conversationId: 7,
          conversationUuid: 'uuid-7',
          projectId: 'p1',
          setChatHistory,
        }),
      { wrapper: withSocket(client) },
    );

    client.simulateServerEvent('chat_message_delete', { message_group_uid: 'm1' });
    expect(history.map((m) => m.id)).toEqual(['m2']);
  });

  it('does not join a room when conversationId is undefined', () => {
    const client = createTestSocketClient();
    renderHook(
      () =>
        usePipelineChatSockets({
          conversationId: undefined,
          conversationUuid: undefined,
          projectId: 'p1',
          setChatHistory: () => {},
        }),
      { wrapper: withSocket(client) },
    );

    expect(client.getEmitted('chat_enter_room')).toEqual([]);
  });
});
