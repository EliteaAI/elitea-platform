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
  it('isStreaming is false when there is no active conversation', () => {
    const socket = createTestSocketClient();
    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter(),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: null,
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation: () => {},
      }),
    );
    expect(result.current.isStreaming).toBe(false);
  });

  it('isStreaming is false when no message is in-flight', () => {
    const socket = createTestSocketClient();
    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter(),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [{ id: 'm1', role: 'assistant' }] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation: () => {},
      }),
    );
    expect(result.current.isStreaming).toBe(false);
  });

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

  // The server removes an answer together with the question it replies to and
  // names both. Pruning only the requested id leaves that question on screen
  // until a reload. Same contract as the agents hook, which shares this adapter.
  it('onDeleteMessage removes every group the server reports it deleted', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({ deleted: ['answer', 'question'] });
    let history: ChatHistoryMessage[] = [
      { id: 'question', role: 'user' },
      { id: 'answer', role: 'assistant' },
      { id: 'keep', role: 'assistant' },
    ];
    const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
      history = typeof update === 'function' ? update(history) : update;
    });

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
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('answer');
    });

    expect(history).toEqual([{ id: 'keep', role: 'assistant' }]);
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

  it('onDeleteMessage falls back to the default failure message when the error has no message text', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({ error: new Error('') });
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
        setChatHistory: () => {},
        setActiveConversation: () => {},
        onError,
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(onError).toHaveBeenCalledWith('Failed to delete the message, please try again.');
  });

  it('onDeleteMessage stringifies a non-Error error value', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({ error: 'a plain string failure' });
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
        setChatHistory: () => {},
        setActiveConversation: () => {},
        onError,
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(onError).toHaveBeenCalledWith('a plain string failure');
  });

  it('onDeleteMessage invokes the optional callback after updating chat history', async () => {
    const socket = createTestSocketClient();
    const deleteMessage = vi.fn().mockResolvedValue({});
    let history: ChatHistoryMessage[] = [{ id: 'm1', role: 'user' }];
    const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
      history = typeof update === 'function' ? update(history) : update;
    });
    const callback = vi.fn();

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
      }),
    );

    await act(async () => {
      await result.current.onDeleteMessage('m1', callback);
    });

    expect(callback).toHaveBeenCalledTimes(1);
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

  it('onStopStreaming skips stopChatTask when the message has no task_id, but still emits chat_leave_rooms', async () => {
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
      await result.current.onStopStreaming({ id: 'm1', role: 'assistant' })();
    });

    expect(stopChatTask).not.toHaveBeenCalled();
    expect(socket.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: ['m1'] }]);
  });

  it('onStopStreaming clears isStreaming/isLoading/task_id on the targeted message (not others) after its 200ms delay', async () => {
    vi.useFakeTimers();
    try {
      const socket = createTestSocketClient();
      let history: ChatHistoryMessage[] = [
        { id: 'm1', role: 'assistant', isStreaming: true, isLoading: true, task_id: 't1' },
        { id: 'm2', role: 'assistant', isStreaming: true, isLoading: true, task_id: 't2' },
      ];
      const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
        history = typeof update === 'function' ? update(history) : update;
      });

      const { result } = renderHook(() =>
        usePipelineChatStreaming({
          socket,
          adapter: baseAdapter(),
          projectId: 'p1',
          pipelineName: 'My Pipeline',
          pipelineVersionDetails: undefined,
          pipelineParticipant: null,
          activeConversation: { id: 1, chat_history: [] },
          activeParticipantId: undefined,
          chatHistoryRef: { current: history },
          setChatHistory,
          setActiveConversation: () => {},
        }),
      );

      await act(async () => {
        const stopPromise = result.current.onStopStreaming({ id: 'm1', role: 'assistant', task_id: 't1' })();
        await vi.advanceTimersByTimeAsync(200);
        await stopPromise;
      });

      expect(history[0]).toMatchObject({ id: 'm1', isStreaming: false, isLoading: false, task_id: undefined });
      // The other in-flight message is untouched.
      expect(history[1]).toMatchObject({ id: 'm2', isStreaming: true, isLoading: true, task_id: 't2' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('onStopAll stops every in-flight message\'s task and clears them all after the delay, leaving user messages alone', async () => {
    vi.useFakeTimers();
    try {
      const socket = createTestSocketClient();
      const stopChatTask = vi.fn().mockResolvedValue(undefined);
      let history: ChatHistoryMessage[] = [
        { id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' },
        { id: 'm2', role: 'assistant', isLoading: true, task_id: 't2' },
        { id: 'm3', role: 'user', isStreaming: true },
      ];
      const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
        history = typeof update === 'function' ? update(history) : update;
      });

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
          chatHistoryRef: { current: history },
          setChatHistory,
          setActiveConversation: () => {},
        }),
      );

      await act(async () => {
        const stopPromise = result.current.onStopAll();
        await vi.advanceTimersByTimeAsync(200);
        await stopPromise;
      });

      expect(stopChatTask).toHaveBeenCalledTimes(2);
      expect(stopChatTask).toHaveBeenCalledWith({ projectId: 'p1', messageGroupUuid: 'm1' });
      expect(stopChatTask).toHaveBeenCalledWith({ projectId: 'p1', messageGroupUuid: 'm2' });
      expect(socket.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: ['m1', 'm2'] }]);
      expect(history[0]).toMatchObject({ isStreaming: false, isLoading: false, isRegenerating: false, task_id: undefined });
      // The user's own in-flight-shaped message is reset too (onStopAll's reset sweeps the whole
      // list uniformly) -- only the *selection* of which tasks to stop excludes the User role.
      expect(history[2]).toMatchObject({ isStreaming: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('onStopAll does not emit chat_leave_rooms when nothing is in-flight', async () => {
    const socket = createTestSocketClient();
    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter(),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [{ id: 'm1', role: 'assistant' }] },
        setChatHistory: () => {},
        setActiveConversation: () => {},
      }),
    );

    await act(async () => {
      await result.current.onStopAll();
    });

    expect(socket.getEmitted('chat_leave_rooms')).toEqual([]);
  });

  it('onDeleteAllMessages surfaces an error via onError and does not reset the conversation on failure', async () => {
    const socket = createTestSocketClient();
    const deleteAllMessages = vi.fn().mockResolvedValue({ error: new Error('delete-all failed') });
    const setActiveConversation = vi.fn();
    const onError = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteAllMessages }),
        projectId: 'p1',
        pipelineName: 'My Pipeline',
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation,
        onError,
      }),
    );

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(onError).toHaveBeenCalledWith('delete-all failed');
    expect(setActiveConversation).not.toHaveBeenCalled();
  });

  it('onDeleteAllMessages invokes the optional callback after resetting the conversation', async () => {
    const socket = createTestSocketClient();
    const deleteAllMessages = vi.fn().mockResolvedValue({});
    const callback = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteAllMessages }),
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
      await result.current.onDeleteAllMessages(callback);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('onDeleteAllMessages builds a fresh conversation with no welcome message when pipelineVersionDetails has none, and no participants when there is none', async () => {
    const socket = createTestSocketClient();
    const deleteAllMessages = vi.fn().mockResolvedValue({});
    const setActiveConversation = vi.fn<(conversation: ChatConversation) => void>();

    const { result } = renderHook(() =>
      usePipelineChatStreaming({
        socket,
        adapter: baseAdapter({ deleteAllMessages }),
        projectId: 'p1',
        pipelineName: undefined,
        pipelineVersionDetails: undefined,
        pipelineParticipant: null,
        activeConversation: { id: 1, chat_history: [] },
        activeParticipantId: undefined,
        chatHistoryRef: { current: [] },
        setChatHistory: () => {},
        setActiveConversation,
      }),
    );

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    const freshConversation = setActiveConversation.mock.calls[0]?.[0];
    expect(freshConversation?.chat_history).toEqual([]);
    expect(freshConversation?.participants).toEqual([]);
    expect(freshConversation?.name).toBe('Chat with ');
  });

  it('onDeleteAllMessages stops in-flight messages via onStopAll before deleting', async () => {
    vi.useFakeTimers();
    try {
      const socket = createTestSocketClient();
      const stopChatTask = vi.fn().mockResolvedValue(undefined);
      const deleteAllMessages = vi.fn().mockResolvedValue({});

      const { result } = renderHook(() =>
        usePipelineChatStreaming({
          socket,
          adapter: baseAdapter({ stopChatTask, deleteAllMessages }),
          projectId: 'p1',
          pipelineName: 'My Pipeline',
          pipelineVersionDetails: undefined,
          pipelineParticipant: null,
          activeConversation: { id: 1, chat_history: [] },
          activeParticipantId: undefined,
          chatHistoryRef: { current: [{ id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' }] },
          setChatHistory: () => {},
          setActiveConversation: () => {},
        }),
      );

      await act(async () => {
        const p = result.current.onDeleteAllMessages();
        await vi.advanceTimersByTimeAsync(200);
        await p;
      });

      expect(stopChatTask).toHaveBeenCalledWith({ projectId: 'p1', messageGroupUuid: 'm1' });
      expect(deleteAllMessages).toHaveBeenCalledWith({ projectId: 'p1', conversationId: 1 });
    } finally {
      vi.useRealTimers();
    }
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
