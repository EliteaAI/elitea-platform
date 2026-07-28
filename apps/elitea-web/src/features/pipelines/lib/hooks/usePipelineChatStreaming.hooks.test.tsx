import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTestSocketClient } from '@/shared/api/socket/testing';

import { usePipelineChatStreaming } from './usePipelineChatStreaming.hooks';
import type { ChatConversation, ChatConversationAdapter, ChatHistoryMessage } from './pipelineChat.types';

function baseAdapter(overrides: Partial<ChatConversationAdapter> = {}): ChatConversationAdapter {
  return {
    createConversation: vi.fn(),
    deleteMessage: vi.fn().mockResolvedValue({}),
    deleteAllMessages: vi.fn().mockResolvedValue({}),
    stopChatTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('usePipelineChatStreaming', () => {
  it('isStreaming is true when any message is in-flight', () => {
    const socket = createTestSocketClient();
    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter(),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [{ id: 'm1', role: 'assistant', isStreaming: true }] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation: () => {},
      }),
    );
    expect(result.current.isStreaming).toBe(true);
  });

  it('onDeleteMessage calls adapter.deleteMessage and filters the message out on success', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({});
    let history: ChatHistoryMessage[] = [{ id: 'm1', role: 'user' }];
    const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
      history = typeof update === 'function' ? update(history) : update;
    });
    const onInfo = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteMessage }),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: history },
        setChatHistory,
        setActiveConversation: () => {},
        onInfo,
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(deleteMessage).toHaveBeenCalledWith({ conversationId: 1, projectId: 'p1', id: 'm1' });
    expect(history).toEqual([]);
    expect(onInfo).toHaveBeenCalledWith('The message has been deleted');
  });

  it('onDeleteMessage surfaces an error via onError and does not touch chat history on failure', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({ error: new Error('nope') });
    const setChatHistory = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteMessage }),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory,
        setActiveConversation: () => {},
        onError,
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(onError).toHaveBeenCalledWith('nope');
    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('onStopStreaming stops the chat task (when task_id is set) and emits chat_leave_rooms for the stream id', async () => {
    const socket = createTestSocketClient();
    const stopChatTask = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ stopChatTask }),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation: () => {},
      }),
    );

    await act(async () => {
      await result.current.onStopStreaming({ id: 'm1', role: 'assistant', task_id: 't1' })();
    });

    expect(stopChatTask).toHaveBeenCalledWith({ projectId: 'p1', messageGroupUuid: 'm1' });
    expect(socket.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: ['m1'] }]);
  });

  it('onDeleteAllMessages stops streaming, clears the conversation via adapter, and resets to a fresh conversation', async () => {
    const socket = createTestSocketClient();
    const deleteAllMessages = vi.fn().mockResolvedValue({});
    const setActiveConversation = vi.fn<(conversation: ChatConversation) => void>();
    const onInfo = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteAllMessages }),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: { welcome_message: 'Hi' },
        pipelineParticipant: { id: '2', entityName: 'application', entityMeta: {}, entitySettings: {} },
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: '2',
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation,
        onInfo,
      }),
    );

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(deleteAllMessages).toHaveBeenCalledWith({ projectId: 'p1', conversationId: 1 });
    await waitFor(() => expect(setActiveConversation).toHaveBeenCalled());
    const freshConversation = setActiveConversation.mock.calls[0]?.[0];
    expect(freshConversation).toMatchObject({ isNew: true, isPipelineChat: true, source: 'pipeline' });
    expect(freshConversation?.chat_history).toHaveLength(1);
    expect(onInfo).toHaveBeenCalledWith('The messages have been deleted');
  });
});
