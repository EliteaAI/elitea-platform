import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '../../../../test/setup';

import { usePipelineChat } from './usePipelineChat.hooks';
import type { ChatConversationAdapter } from './usePipelineChat.hooks';
import type { UsePipelineChatParams } from './pipelineChat.types';

const BASE = '/api/v2';

function createWrapper(client: TestSocketClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <SocketClientContext.Provider value={client}>{children}</SocketClientContext.Provider>
      </QueryClientProvider>
    );
  };
}

function stubAdapter(overrides: Partial<ChatConversationAdapter> = {}): ChatConversationAdapter {
  return {
    createConversation: vi.fn().mockResolvedValue({
      data: { id: 99, uuid: 'uuid-99', participants: [{ id: '2', entityName: 'application', entityMeta: {}, entitySettings: {} }] },
    }),
    deleteMessage: vi.fn().mockResolvedValue({}),
    deleteAllMessages: vi.fn().mockResolvedValue({}),
    stopChatTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function baseParams(overrides: Partial<UsePipelineChatParams> = {}): UsePipelineChatParams {
  return {
    pipelineId: '1',
    pipelineName: 'My Pipeline',
    pipelineVersionDetails: { id: 5, welcome_message: 'Hi there' },
    projectId: 'p1',
    setFieldValue: vi.fn(),
    onRestoreConversationComplete: vi.fn(),
    adapter: stubAdapter(),
    ...overrides,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('usePipelineChat', () => {
  it('creates a fresh pipeline conversation on mount and exposes activeParticipantDetails', async () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams(),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({ source: 'pipeline', isPipelineChat: true, isNew: true });
    expect(result.current.activeParticipantDetails).toMatchObject({
      id: '1',
      name: 'My Pipeline',
      agent_type: 'pipeline',
      project_id: 'p1',
    });
  });

  it('onSend creates the conversation via the adapter on the first message and joins its socket room', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ adapter }),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    let response;
    await act(async () => {
      response = await result.current.onSend({
        needsConversationCreation: true,
        userInput: 'hello',
        newMessages: [{ id: 'm1', role: 'user' }],
        eventPayload: {},
      });
    });

    expect(adapter.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Chat with My Pipeline', source: 'pipeline' }),
    );
    expect(response).toMatchObject({ success: true });
    await waitFor(() => expect(client.getEmitted('chat_enter_room').length).toBeGreaterThan(0));
  });

  it('onChangeParticipantSettings writes llm_settings fields via setFieldValue', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ setFieldValue }),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.onChangeParticipantSettings('2', { entity_settings: { llm_settings: { temperature: 0.9 } } });
    });

    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.temperature', 0.9);
  });

  it('onChangeParticipantSettings is a no-op when there is no participantId and the pipeline is not being created (baseline `usePipelineChat.hooks.js:640-642` guard)', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      // pipelineId is defined ('1') -> not creating a brand new pipeline.
      initialProps: baseParams({ setFieldValue, pipelineId: '1' }),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.onChangeParticipantSettings('', { entity_settings: { llm_settings: { temperature: 0.9 } } });
    });

    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('onChangeParticipantSettings still applies updates with no participantId when the pipeline IS being created (pipelineId undefined)', () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ setFieldValue, pipelineId: undefined }),
    });

    act(() => {
      result.current.onChangeParticipantSettings('', { entity_settings: { llm_settings: { temperature: 0.9 } } });
    });

    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.temperature', 0.9);
  });

  it('onSetLLMSettings writes every field via setFieldValue', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ setFieldValue }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.onSetLLMSettings({ model_name: 'gpt-4', max_tokens: 2048 });
    });

    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.model_name', 'gpt-4');
    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.max_tokens', 2048);
  });

  it('calls deleteAllRunNodes whenever the version id changes (but not on the very first mount, since it has nothing to clear)', () => {
    const client = createTestSocketClient();
    const deleteAllRunNodes = vi.fn();
    const { rerender } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ deleteAllRunNodes }),
    });

    // The baseline itself calls this unconditionally, including on mount (`[pipelineVersionDetails?.id]`
    // fires on every commit whose deps changed, and React runs every effect once on mount too).
    expect(deleteAllRunNodes).toHaveBeenCalledTimes(1);

    rerender(baseParams({ deleteAllRunNodes, pipelineVersionDetails: { id: 6, welcome_message: 'Hi' } }));
    expect(deleteAllRunNodes).toHaveBeenCalledTimes(2);
  });

  it('sets error/errorMessage through useAutoSwitchPipelineChatVersion when a version switch PUT fails, without throwing', async () => {
    server.use(
      http.put('*/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId', () =>
        HttpResponse.json({ error: 'nope' }, { status: 400 }),
      ),
    );
    const client = createTestSocketClient();
    const onError = vi.fn();
    const { result, rerender } = renderHook((p: UsePipelineChatParams) => usePipelineChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ onError }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    // Establish a real conversation id + participant id first (switch only fires once both exist).
    await act(async () => {
      await result.current.onSend({ needsConversationCreation: true, newMessages: [], eventPayload: {} });
    });

    rerender(baseParams({ onError, pipelineVersionDetails: { id: 7, welcome_message: 'Hi' } }));

    // Does not throw — the failure is swallowed by `usePipelineChatSwitchVersion`'s own error state, not surfaced through `onError`/`onSend`.
    expect(result.current.activeConversation).not.toBeNull();
  });
});
