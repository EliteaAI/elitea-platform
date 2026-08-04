import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Participant } from '@/entities/participant';

import type { ChatConversation, SendMessageData } from './applicationChat.types';
import type { UseApplicationChatMessagingParams } from './useApplicationChatMessaging.hooks';
import { useApplicationChatMessaging } from './useApplicationChatMessaging.hooks';

const applicationParticipant: Participant = { id: '1', entityName: 'application' };

function baseParams(overrides: Partial<UseApplicationChatMessagingParams> = {}): UseApplicationChatMessagingParams {
  return {
    applicationName: 'My App',
    applicationParticipant,
    applicationVersionDetails: { meta: { internal_tools: ['t1'] } },
    projectId: 'proj-1',
    source: 'agent',
    adapter: {
      createConversation: vi.fn().mockResolvedValue({ data: { id: 99, uuid: 'uuid-99', participants: [applicationParticipant] } }),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    },
    activeConversationId: undefined,
    setActiveConversation: vi.fn(),
    setActiveParticipant: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

function setup(overrides: Partial<UseApplicationChatMessagingParams> = {}) {
  const params = baseParams(overrides);
  const { result, rerender } = renderHook((p: UseApplicationChatMessagingParams) => useApplicationChatMessaging(p), {
    initialProps: params,
  });
  return { result, rerender, params };
}

describe('useApplicationChatMessaging — createConversationOnFirstMessage', () => {
  it('creates the conversation via the adapter, stamps participant ids, and returns success', async () => {
    const setActiveConversation = vi.fn();
    const setActiveParticipant = vi.fn();
    const { result } = setup({ setActiveConversation, setActiveParticipant });

    const messageData: SendMessageData = {
      needsConversationCreation: true,
      userInput: 'hello',
      question_id: 'q1',
      newMessages: [
        { id: 'm1', role: 'user', participant_id: 'orig-user' },
        { id: 'm2', role: 'assistant' },
      ],
      eventPayload: {},
    };

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend(messageData);
    });

    expect(result.current).toBeDefined();
    expect(response).toMatchObject({ success: true });
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;

    expect(r.createdConversation).toMatchObject({
      id: 99,
      uuid: 'uuid-99',
      chat_history: [],
      isApplicationChat: true,
      participants: [applicationParticipant],
    });
    // Resolved participant is the 'application' one found in result.data.participants.
    expect(r.activeParticipant).toEqual(applicationParticipant);
    expect(setActiveConversation).toHaveBeenCalledWith(r.createdConversation);
    expect(setActiveParticipant).toHaveBeenCalledWith(applicationParticipant);

    // A user message keeps its own participant_id; a non-user message gets stamped with the resolved participant's id.
    expect(r.updatedMessages).toEqual([
      { id: 'm1', role: 'user', participant_id: 'orig-user' },
      { id: 'm2', role: 'assistant', participant_id: '1' },
    ]);

    // No llm_settings on eventPayload -> falls back to buildLlmSettingsFallback (all undefined, since applicationVersionDetails has no llm_settings here).
    expect(r.updatedEventPayload).toMatchObject({
      user_input: 'hello',
      project_id: 'proj-1',
      conversation_uuid: 'uuid-99',
      question_id: 'q1',
      participant_id: '1',
      llm_settings: { model_name: undefined, model_project_id: undefined, max_tokens: undefined, temperature: undefined, reasoning_effort: undefined },
    });
  });

  it('uses eventPayload.llm_settings verbatim when the caller already supplied one', async () => {
    const { result } = setup();
    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({
        needsConversationCreation: true,
        eventPayload: { llm_settings: { model_name: 'gpt-4' }, attachments_info: ['a1'], mcp_tokens: ['tok'], ignored_mcp_servers: ['s1'] },
      });
    });
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;
    expect(r.updatedEventPayload).toMatchObject({
      llm_settings: { model_name: 'gpt-4' },
      attachments_info: ['a1'],
      mcp_tokens: ['tok'],
      ignored_mcp_servers: ['s1'],
    });
  });

  it('falls back to applicationParticipant (and does not call setActiveParticipant) when no application participant is present in the created conversation', async () => {
    const setActiveParticipant = vi.fn();
    const adapter = {
      createConversation: vi.fn().mockResolvedValue({ data: { id: 5, uuid: 'uuid-5', participants: [{ id: '2', entityName: 'toolkit' as const }] } }),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter, setActiveParticipant });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true, newMessages: [{ id: 'm1', role: 'assistant' }] });
    });

    expect(setActiveParticipant).not.toHaveBeenCalled();
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;
    expect(r.activeParticipant).toEqual(applicationParticipant);
    expect(r.updatedMessages).toEqual([{ id: 'm1', role: 'assistant', participant_id: '1' }]);
  });

  it('defaults createdConversation.participants to [] when the adapter result has none', async () => {
    const adapter = {
      createConversation: vi.fn().mockResolvedValue({ data: { id: 5, uuid: 'uuid-5' } }),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true });
    });
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;
    expect(r.createdConversation?.participants).toEqual([]);
  });

  it('calls the adapter with is_private/name/source/meta/participants/projectId built from params', async () => {
    const adapter = baseParams().adapter;
    const { result } = setup({ adapter, applicationName: 'Widget', source: 'pipeline', projectId: 'proj-9' });

    await act(async () => {
      await result.current.onSend({ needsConversationCreation: true });
    });

    expect(adapter.createConversation).toHaveBeenCalledWith({
      is_private: true,
      name: 'Chat with Widget',
      source: 'pipeline',
      meta: { single_participant: applicationParticipant, internal_tools: ['t1'] },
      participants: [applicationParticipant],
      projectId: 'proj-9',
    });
  });

  it('falls back to an empty application name when applicationName is undefined', async () => {
    const adapter = baseParams().adapter;
    const { result } = setup({ adapter, applicationName: undefined });

    await act(async () => {
      await result.current.onSend({ needsConversationCreation: true });
    });

    expect(adapter.createConversation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chat with ' }));
  });

  it('returns failure and calls onError without invoking the adapter when applicationParticipant is null', async () => {
    const onError = vi.fn();
    const adapter = baseParams().adapter;
    const { result } = setup({ applicationParticipant: null, onError, adapter });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true });
    });

    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
    expect(adapter.createConversation).not.toHaveBeenCalled();
  });

  it('returns failure and calls onError when the adapter resolves without data', async () => {
    const onError = vi.fn();
    const adapter = {
      createConversation: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter, onError });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true });
    });

    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
  });

  // A1-application-chat cluster, finding 3: baseline (`useApplicationChat.hooks.js:374-380`) ALWAYS
  // shows the fixed 'Failed to create conversation' message on a catch, regardless of what was
  // thrown — the real error only ever reaches `console.error`, never the user. These three tests
  // (Error / string / plain-object rejection) all assert that same fixed message; previously this
  // catch surfaced the raw `applicationErrorMessage(caught)` text instead, which leaked internal
  // error text for a real Error/string and degraded to the literal "[object Object]" for anything
  // else (the untested edge case the finding flagged).
  it('catches a thrown Error and reports the fixed, sanitized message via onError (not the raw error text)', async () => {
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = {
      createConversation: vi.fn().mockRejectedValue(new Error('network down')),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter, onError });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true });
    });

    expect(response).toEqual({ success: false });
    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create conversation:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('catches a thrown string value and still reports the fixed message via onError', async () => {
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = {
      createConversation: vi.fn().mockRejectedValue('boom'),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter, onError });

    await act(async () => {
      await result.current.onSend({ needsConversationCreation: true });
    });

    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
    consoleErrorSpy.mockRestore();
  });

  it('catches a thrown plain-object rejection and reports the fixed message, not the literal "[object Object]"', async () => {
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = {
      createConversation: vi.fn().mockRejectedValue({ some: 'shape' }),
      deleteMessage: vi.fn().mockResolvedValue({}),
      deleteAllMessages: vi.fn().mockResolvedValue({}),
      stopChatTask: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = setup({ adapter, onError });

    await act(async () => {
      await result.current.onSend({ needsConversationCreation: true });
    });

    expect(onError).toHaveBeenCalledWith('Failed to create conversation');
    expect(onError).not.toHaveBeenCalledWith('[object Object]');
    consoleErrorSpy.mockRestore();
  });

  it('does not create a new conversation when needsConversationCreation is true but activeConversationId is already set', async () => {
    const adapter = baseParams().adapter;
    const { result } = setup({ adapter, activeConversationId: 42 });

    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ needsConversationCreation: true, eventPayload: { llm_settings: { model_name: 'gpt' } } });
    });

    expect(adapter.createConversation).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true });
  });
});

describe('useApplicationChatMessaging — sendToExistingConversation', () => {
  it('returns bare success (no updatedEventPayload) when eventPayload already has a model_name', async () => {
    const { result } = setup({ activeConversationId: 1 });
    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ eventPayload: { llm_settings: { model_name: 'gpt-4' } } });
    });
    expect(response).toEqual({ success: true });
  });

  it('fills in the llm_settings fallback when eventPayload is entirely undefined', async () => {
    const { result } = setup({
      activeConversationId: 1,
      applicationVersionDetails: { llm_settings: { model_name: 'fallback-model' } },
    });
    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({});
    });
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;
    expect(r.success).toBe(true);
    expect(r.updatedEventPayload).toMatchObject({ llm_settings: { model_name: 'fallback-model' } });
  });

  it('keeps an existing llm_settings object as-is when it has no model_name key (still truthy, so no fallback)', async () => {
    const { result } = setup({
      activeConversationId: 1,
      applicationVersionDetails: { llm_settings: { model_name: 'should-not-be-used' } },
    });
    let response: Awaited<ReturnType<typeof result.current.onSend>> | undefined;
    await act(async () => {
      response = await result.current.onSend({ eventPayload: { llm_settings: { temperature: 0.4 } } });
    });
    const r = response as Awaited<ReturnType<typeof result.current.onSend>>;
    expect(r.updatedEventPayload?.['llm_settings']).toEqual({ temperature: 0.4 });
  });
});

describe('useApplicationChatMessaging — return identity', () => {
  it('keeps onSend referentially stable across renders when nothing relevant changed', () => {
    const { result, rerender, params } = setup();
    const first = result.current.onSend;
    rerender(params);
    expect(result.current.onSend).toBe(first);
  });
});

// Sanity type-check the exported ChatConversation import is meaningfully referenced.
const _typeCheck: ChatConversation = { chat_history: [] };
void _typeCheck;
