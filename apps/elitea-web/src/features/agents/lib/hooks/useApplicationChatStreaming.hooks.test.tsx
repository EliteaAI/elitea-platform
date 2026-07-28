import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';
import type { Participant } from '@/entities/participant';

import type { ChatConversation, ChatConversationAdapter, ChatHistoryMessage } from './applicationChat.types';
import type { UseApplicationChatStreamingParams } from './useApplicationChatStreaming.hooks';
import { useApplicationChatStreaming } from './useApplicationChatStreaming.hooks';

const applicationParticipant: Participant = { id: '1', entityName: 'application' };

function stubAdapter(overrides: Partial<ChatConversationAdapter> = {}): ChatConversationAdapter {
  return {
    createConversation: vi.fn().mockResolvedValue({ data: { id: 1, uuid: 'u1', participants: [] } }),
    deleteMessage: vi.fn().mockResolvedValue({}),
    deleteAllMessages: vi.fn().mockResolvedValue({}),
    stopChatTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseParams(
  client: TestSocketClient,
  overrides: Partial<UseApplicationChatStreamingParams> & { chatHistory?: ChatHistoryMessage[] } = {},
) {
  const { chatHistory = [], ...rest } = overrides;
  const chatHistoryRef = { current: chatHistory };
  let history: ChatHistoryMessage[] = chatHistory;
  const setChatHistory = vi.fn((update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[])) => {
    history = typeof update === 'function' ? update(history) : update;
    chatHistoryRef.current = history;
  });
  const params: UseApplicationChatStreamingParams = {
    socket: client,
    adapter: stubAdapter(),
    projectId: 'proj-1',
    applicationName: 'My App',
    applicationVersionDetails: { welcome_message: 'Hi there' },
    applicationParticipant,
    activeConversation: { id: 5, chat_history: chatHistory },
    activeParticipantId: '1',
    chatHistoryRef,
    setChatHistory,
    setActiveConversation: vi.fn(),
    onInfo: vi.fn(),
    onError: vi.fn(),
    ...rest,
  };
  return { params, setChatHistory, chatHistoryRef, getHistory: () => history };
}

async function flushTimers(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
}

describe('useApplicationChatStreaming — isStreaming', () => {
  it('is false when activeConversation is null', () => {
    const client = createTestSocketClient();
    const { params } = baseParams(client, { activeConversation: null });
    const { result } = renderHook(() => useApplicationChatStreaming(params));
    expect(result.current.isStreaming).toBe(false);
  });

  it('is false when no message in chat_history is in flight', () => {
    const client = createTestSocketClient();
    const { params } = baseParams(client, {
      activeConversation: { id: 5, chat_history: [{ id: 'm1', role: 'assistant', isStreaming: false }] },
    });
    const { result } = renderHook(() => useApplicationChatStreaming(params));
    expect(result.current.isStreaming).toBe(false);
  });

  it('is true when a message in chat_history has isStreaming/isLoading/isRegenerating', () => {
    const client = createTestSocketClient();
    const { params } = baseParams(client, {
      activeConversation: { id: 5, chat_history: [{ id: 'm1', role: 'assistant', isStreaming: true }] },
    });
    const { result } = renderHook(() => useApplicationChatStreaming(params));
    expect(result.current.isStreaming).toBe(true);
  });
});

describe('useApplicationChatStreaming — onStopStreaming', () => {
  it('calls adapter.stopChatTask and emits chat_leave_rooms when the message has a task_id, then clears its fields after the debounce', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { params, setChatHistory } = baseParams(client, {
      adapter,
      activeConversation: { id: 5, chat_history: [{ id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' }] },
    });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopStreaming({ id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' })();
    });

    expect(adapter.stopChatTask).toHaveBeenCalledWith({ projectId: 'proj-1', messageGroupUuid: 'm1' });
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
    expect(client.getEmitted('chat_leave_rooms')[0]?.payload).toEqual(['m1']);

    await flushTimers();
    expect(setChatHistory).toHaveBeenCalled();
    const updater = setChatHistory.mock.calls[0]?.[0] as (prev: ChatHistoryMessage[]) => ChatHistoryMessage[];
    const updated = updater([{ id: 'm1', role: 'assistant', isStreaming: true, isLoading: true, task_id: 't1' }]);
    expect(updated[0]).toMatchObject({ isStreaming: false, isLoading: false, task_id: undefined });
  });

  it('does not call adapter.stopChatTask when the message has no task_id', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { params } = baseParams(client, { adapter });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopStreaming({ id: 'm2', role: 'assistant' })();
    });

    expect(adapter.stopChatTask).not.toHaveBeenCalled();
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });

  it('clearStreamFields leaves other messages in the history untouched', async () => {
    const client = createTestSocketClient();
    const { params, setChatHistory } = baseParams(client);
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopStreaming({ id: 'm1', role: 'assistant', task_id: 't1' })();
    });
    await flushTimers();

    const updater = setChatHistory.mock.calls[0]?.[0] as (prev: ChatHistoryMessage[]) => ChatHistoryMessage[];
    const untouched: ChatHistoryMessage = { id: 'm-other', role: 'assistant', isStreaming: true, task_id: 't-other' };
    const updated = updater([untouched]);
    expect(updated[0]).toEqual(untouched);
  });
});

describe('useApplicationChatStreaming — onStopAll', () => {
  it('stops every non-user in-flight message and emits chat_leave_rooms with all their ids', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const inFlight: ChatHistoryMessage[] = [
      { id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' },
      { id: 'm2', role: 'assistant', isLoading: true, task_id: 't2' },
      { id: 'm3', role: 'user', isStreaming: true, task_id: 't3' }, // user messages are excluded
      { id: 'm4', role: 'assistant' }, // not in flight
    ];
    const { params, setChatHistory } = baseParams(client, { adapter, chatHistory: inFlight });

    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopAll();
    });

    expect(adapter.stopChatTask).toHaveBeenCalledTimes(2);
    expect(adapter.stopChatTask).toHaveBeenCalledWith({ projectId: 'proj-1', messageGroupUuid: 'm1' });
    expect(adapter.stopChatTask).toHaveBeenCalledWith({ projectId: 'proj-1', messageGroupUuid: 'm2' });
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
    expect(client.getEmitted('chat_leave_rooms')[0]?.payload).toEqual(['m1', 'm2']);

    await flushTimers();
    const updater = setChatHistory.mock.calls.at(-1)?.[0] as (prev: ChatHistoryMessage[]) => ChatHistoryMessage[];
    const updated = updater(inFlight);
    for (const msg of updated) {
      expect(msg.isStreaming).toBe(false);
      expect(msg.isLoading).toBe(false);
      expect(msg.isRegenerating).toBe(false);
      expect(msg.task_id).toBeUndefined();
    }
  });

  it('does not emit chat_leave_rooms when nothing is in flight', async () => {
    const client = createTestSocketClient();
    const { params } = baseParams(client, { chatHistory: [{ id: 'm1', role: 'assistant' }] });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopAll();
    });

    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(0);
  });

  it('does not call stopChatTask for an in-flight message with no task_id', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { params } = baseParams(client, { adapter, chatHistory: [{ id: 'm1', role: 'assistant', isStreaming: true }] });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onStopAll();
    });

    expect(adapter.stopChatTask).not.toHaveBeenCalled();
    // Still leaves the room for the in-flight message id.
    expect(client.getEmitted('chat_leave_rooms')[0]?.payload).toEqual(['m1']);
  });
});

describe('useApplicationChatStreaming — onDeleteMessage', () => {
  it('removes the message, invokes the callback, and calls onInfo on success', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const onInfo = vi.fn();
    const { params, setChatHistory } = baseParams(client, { adapter, onInfo });
    const { result } = renderHook(() => useApplicationChatStreaming(params));
    const callback = vi.fn();

    await act(async () => {
      await result.current.onDeleteMessage('m1', callback);
    });

    expect(adapter.deleteMessage).toHaveBeenCalledWith({ conversationId: 5, projectId: 'proj-1', id: 'm1' });
    expect(setChatHistory).toHaveBeenCalled();
    const updater = setChatHistory.mock.calls[0]?.[0] as (prev: ChatHistoryMessage[]) => ChatHistoryMessage[];
    expect(updater([{ id: 'm1', role: 'user' }, { id: 'm2', role: 'assistant' }])).toEqual([{ id: 'm2', role: 'assistant' }]);
    expect(callback).toHaveBeenCalled();
    expect(onInfo).toHaveBeenCalledWith('The message has been deleted');
  });

  it('calls onError with the error message and does not touch chat history on failure', async () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const adapter = stubAdapter({ deleteMessage: vi.fn().mockResolvedValue({ error: new Error('nope') }) });
    const { params, setChatHistory } = baseParams(client, { adapter, onError });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(onError).toHaveBeenCalledWith('nope');
    expect(setChatHistory).not.toHaveBeenCalled();
  });

  it('falls back to a generic error message when the error is a truthy Error with an empty message', async () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const adapter = stubAdapter({ deleteMessage: vi.fn().mockResolvedValue({ error: new Error('') }) });
    const { params } = baseParams(client, { adapter, onError });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteMessage('m1');
    });

    expect(onError).toHaveBeenCalledWith('Failed to delete the message, please try again.');
  });
});

describe('useApplicationChatStreaming — onDeleteAllMessages', () => {
  it('stops all streams, deletes every message, resets to a fresh conversation, and calls onInfo + callback on success', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const onInfo = vi.fn();
    const setActiveConversation = vi.fn();
    const { params } = baseParams(client, {
      adapter,
      onInfo,
      setActiveConversation,
      chatHistory: [{ id: 'm1', role: 'assistant', isStreaming: true, task_id: 't1' }],
    });
    const { result } = renderHook(() => useApplicationChatStreaming(params));
    const callback = vi.fn();

    await act(async () => {
      await result.current.onDeleteAllMessages(callback);
    });

    expect(adapter.stopChatTask).toHaveBeenCalledWith({ projectId: 'proj-1', messageGroupUuid: 'm1' });
    expect(adapter.deleteAllMessages).toHaveBeenCalledWith({ projectId: 'proj-1', conversationId: 5 });
    expect(setActiveConversation).toHaveBeenCalledWith({
      name: 'Chat with My App',
      is_private: true,
      source: 'agent',
      participants: [applicationParticipant],
      chat_history: [expect.objectContaining({ content: 'Hi there', participant_id: '1' })],
      isNew: true,
      isApplicationChat: true,
    });
    expect(onInfo).toHaveBeenCalledWith('The messages have been deleted');
    expect(callback).toHaveBeenCalled();
  });

  it('builds an empty participants array and empty chat_history when applicationParticipant/welcome_message are absent', async () => {
    const client = createTestSocketClient();
    const setActiveConversation = vi.fn();
    const { params } = baseParams(client, {
      applicationParticipant: null,
      applicationVersionDetails: {},
      activeParticipantId: undefined,
      setActiveConversation,
    });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(setActiveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ participants: [], chat_history: [] }),
    );
  });

  it('calls onError and does not reset the conversation when deleteAllMessages fails', async () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const setActiveConversation = vi.fn();
    const adapter = stubAdapter({ deleteAllMessages: vi.fn().mockResolvedValue({ error: new Error('db down') }) });
    const { params } = baseParams(client, { adapter, onError, setActiveConversation });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(onError).toHaveBeenCalledWith('db down');
    expect(setActiveConversation).not.toHaveBeenCalled();
  });

  it('falls back to a generic error message when deleteAllMessages fails with a truthy Error whose message is empty', async () => {
    const client = createTestSocketClient();
    const onError = vi.fn();
    const adapter = stubAdapter({ deleteAllMessages: vi.fn().mockResolvedValue({ error: new Error('') }) });
    const { params } = baseParams(client, { adapter, onError });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(onError).toHaveBeenCalledWith('Failed to delete the message, please try again.');
  });

  it('does not throw when deleteAllMessages fails and no onError callback was supplied', async () => {
    const client = createTestSocketClient();
    const setActiveConversation = vi.fn();
    const adapter = stubAdapter({ deleteAllMessages: vi.fn().mockResolvedValue({ error: new Error('db down') }) });
    const { params } = baseParams(client, { adapter, onError: undefined, setActiveConversation });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await expect(act(async () => {
      await result.current.onDeleteAllMessages();
    })).resolves.not.toThrow();

    expect(setActiveConversation).not.toHaveBeenCalled();
  });

  it('falls back to an empty application name in the fresh conversation when applicationName is undefined', async () => {
    const client = createTestSocketClient();
    const setActiveConversation = vi.fn();
    const { params } = baseParams(client, { applicationName: undefined, setActiveConversation });
    const { result } = renderHook(() => useApplicationChatStreaming(params));

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(setActiveConversation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chat with ' }));
  });

  it('uses the latest params (via paramsRef) even though onStopAll itself is only recreated when it changes', async () => {
    const client = createTestSocketClient();
    const setActiveConversation1 = vi.fn();
    const setActiveConversation2 = vi.fn();
    const { params: initialParams } = baseParams(client, { setActiveConversation: setActiveConversation1 });
    const { result, rerender } = renderHook((p: UseApplicationChatStreamingParams) => useApplicationChatStreaming(p), {
      initialProps: initialParams,
    });

    const updatedParams: UseApplicationChatStreamingParams = { ...initialParams, setActiveConversation: setActiveConversation2 };
    rerender(updatedParams);

    await act(async () => {
      await result.current.onDeleteAllMessages();
    });

    expect(setActiveConversation1).not.toHaveBeenCalled();
    expect(setActiveConversation2).toHaveBeenCalled();
  });
});

// Sanity type-check the imported ChatConversation type is meaningfully referenced.
const _typeCheck: ChatConversation = { chat_history: [] };
void _typeCheck;
