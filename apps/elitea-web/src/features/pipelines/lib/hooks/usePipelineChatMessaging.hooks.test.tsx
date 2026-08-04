import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Participant } from '@/entities/participant';

import { usePipelineChatMessaging } from './usePipelineChatMessaging.hooks';
import type { ChatConversationAdapter, CreateConversationAdapterResult } from './pipelineChat.types';

const PARTICIPANT: Participant = { id: '2', entityName: 'application', entityMeta: { id: '2' }, entitySettings: {} };

function baseAdapter(overrides: Partial<ChatConversationAdapter> = {}): ChatConversationAdapter {
  return {
    createConversation: vi.fn(),
    deleteMessage: vi.fn(),
    deleteAllMessages: vi.fn(),
    stopChatTask: vi.fn(),
    ...overrides,
  };
}

describe('usePipelineChatMessaging', () => {
  it('sendToExistingConversation branch: fills in a fallback llm_settings when the caller did not provide one', async () => {
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: { llm_settings: { model_name: 'gpt-4' } },
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter(),
        activeConversationId: 1,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
      }),
    );

    const response = await result.current.onSend({ needsConversationCreation: false, eventPayload: {} });
    expect(response.success).toBe(true);
    expect(response.updatedEventPayload?.['llm_settings']).toMatchObject({ model_name: 'gpt-4' });
  });

  it('sendToExistingConversation branch: falls back model_project_id to the current projectId when the version has none', async () => {
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: { llm_settings: { model_name: 'gpt-4' } },
        projectId: 'proj-current',
        source: 'pipeline',
        adapter: baseAdapter(),
        activeConversationId: 1,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
      }),
    );

    const response = await result.current.onSend({ needsConversationCreation: false, eventPayload: {} });
    expect(response.updatedEventPayload?.['llm_settings']).toMatchObject({ model_project_id: 'proj-current' });
  });

  it('sendToExistingConversation branch: leaves the payload untouched when llm_settings.model_name is already set', async () => {
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: undefined,
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter(),
        activeConversationId: 1,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
      }),
    );

    const response = await result.current.onSend({
      needsConversationCreation: false,
      eventPayload: { llm_settings: { model_name: 'already-set' } },
    });
    expect(response).toEqual({ success: true });
  });

  it('createConversationOnFirstMessage: fails cleanly with no pipelineParticipant', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: null,
        pipelineVersionDetails: undefined,
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter(),
        activeConversationId: undefined,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
        onError,
      }),
    );

    const response = await result.current.onSend({ needsConversationCreation: true, newMessages: [] });
    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
  });

  it('createConversationOnFirstMessage: creates the conversation, sets active state, and stamps participant ids onto new messages', async () => {
    const createConversation = vi.fn().mockResolvedValue({
      data: { id: 99, uuid: 'uuid-99', participants: [{ ...PARTICIPANT, id: '999' }] },
    });
    const setActiveConversation = vi.fn();
    const setActiveParticipant = vi.fn();

    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: { meta: { internal_tools: ['attachments'] } },
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter({ createConversation }),
        activeConversationId: undefined,
        setActiveConversation,
        setActiveParticipant,
      }),
    );

    const response = await result.current.onSend({
      needsConversationCreation: true,
      userInput: 'hello',
      question_id: 'q1',
      newMessages: [{ id: 'm1', role: 'user', participant_id: 'user-1' }, { id: 'm2', role: 'assistant' }],
      eventPayload: {},
    });

    expect(createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ is_private: true, name: 'Chat with My Pipeline', source: 'pipeline', projectId: 'p1' }),
    );
    expect(setActiveConversation).toHaveBeenCalled();
    expect(setActiveParticipant).toHaveBeenCalledWith(expect.objectContaining({ id: '999' }));
    expect(response.success).toBe(true);
    expect(response.activeParticipant).toMatchObject({ id: '999' });
    // The user's own message keeps its participant_id; the assistant one is stamped with the resolved participant.
    expect(response.updatedMessages).toEqual([
      { id: 'm1', role: 'user', participant_id: 'user-1' },
      { id: 'm2', role: 'assistant', participant_id: '999' },
    ]);
  });

  it('createConversationOnFirstMessage: surfaces onError and returns failure when the adapter reports no data', async () => {
    const onError = vi.fn();
    const createConversation = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: undefined,
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter({ createConversation }),
        activeConversationId: undefined,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
        onError,
      }),
    );

    const response = await result.current.onSend({ needsConversationCreation: true, newMessages: [] });
    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
  });

  it('createConversationOnFirstMessage: falls back llm_settings.model_project_id to the current projectId when the version has none', async () => {
    const createConversation = vi.fn().mockResolvedValue({
      data: { id: 99, uuid: 'uuid-99', participants: [{ ...PARTICIPANT, id: '999' }] },
    });

    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: undefined,
        projectId: 'proj-current',
        source: 'pipeline',
        adapter: baseAdapter({ createConversation }),
        activeConversationId: undefined,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
      }),
    );

    const response = await result.current.onSend({ needsConversationCreation: true, newMessages: [], eventPayload: {} });
    expect(response.updatedEventPayload?.['llm_settings']).toMatchObject({ model_project_id: 'proj-current' });
  });

  it('isLoadingConversation reflects the real in-flight adapter.createConversation(...) round-trip, and settles back to false afterwards', async () => {
    let resolveCreate!: (value: CreateConversationAdapterResult) => void;
    const createConversation = vi.fn(
      () =>
        new Promise<CreateConversationAdapterResult>((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: undefined,
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter({ createConversation }),
        activeConversationId: undefined,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
      }),
    );

    expect(result.current.isLoadingConversation).toBe(false);

    let sendPromise!: Promise<unknown>;
    act(() => {
      sendPromise = result.current.onSend({ needsConversationCreation: true, newMessages: [], eventPayload: {} });
    });

    expect(result.current.isLoadingConversation).toBe(true);

    await act(async () => {
      resolveCreate({ data: { id: 99, uuid: 'uuid-99', chat_history: [], participants: [{ ...PARTICIPANT, id: '999' }] } });
      await sendPromise;
    });

    expect(result.current.isLoadingConversation).toBe(false);
  });

  it('createConversationOnFirstMessage: catches a thrown error from the adapter and reports it via onError', async () => {
    const onError = vi.fn();
    const createConversation = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() =>
      usePipelineChatMessaging({
        pipelineName: 'My Pipeline',
        pipelineParticipant: PARTICIPANT,
        pipelineVersionDetails: undefined,
        projectId: 'p1',
        source: 'pipeline',
        adapter: baseAdapter({ createConversation }),
        activeConversationId: undefined,
        setActiveConversation: () => {},
        setActiveParticipant: () => {},
        onError,
      }),
    );

    let response;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true, newMessages: [] });
    });
    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('network down');
  });
});
