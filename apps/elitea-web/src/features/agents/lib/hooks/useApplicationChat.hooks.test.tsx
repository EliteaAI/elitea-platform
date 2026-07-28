import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import type { ChatConversationAdapter, UseApplicationChatParams } from './applicationChat.types';
import { useApplicationChat } from './useApplicationChat.hooks';

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

function baseParams(overrides: Partial<UseApplicationChatParams> = {}): UseApplicationChatParams {
  return {
    applicationId: 'app-1',
    applicationName: 'My App',
    applicationVersionDetails: { id: 5, welcome_message: 'Hi there' },
    projectId: 'proj-1',
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

describe('useApplicationChat', () => {
  it('creates a fresh conversation on mount and exposes activeParticipantDetails/isLoadingConversation', async () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams(),
    });

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({ source: 'agent', isNew: true, isApplicationChat: true });
    expect(result.current.activeParticipantDetails).toMatchObject({
      id: 'app-1',
      name: 'My App',
      agent_type: undefined,
      project_id: 'proj-1',
      description: '',
    });
    expect(result.current.isLoadingConversation).toBe(false);
  });

  it('returns null activeParticipantDetails when applicationVersionDetails is undefined', () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ applicationVersionDetails: undefined }),
    });

    expect(result.current.activeParticipantDetails).toBeNull();
  });

  it('reflects isLoadingRestoredConversation in isLoadingConversation even once conversation creation settles', () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ isLoadingRestoredConversation: true, restoredConversationID: 'r1' }),
    });

    expect(result.current.isLoadingConversation).toBe(true);
  });

  it('onSend creates the conversation via the adapter and joins the resulting socket room', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
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

    expect(adapter.createConversation).toHaveBeenCalledWith(expect.objectContaining({ name: 'Chat with My App', source: 'agent' }));
    expect(response).toMatchObject({ success: true });
    await waitFor(() => expect(client.getEmitted('chat_enter_room').length).toBeGreaterThan(0));
  });

  it('onChangeParticipantSettings writes each llm_settings field via setFieldValue', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ setFieldValue }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.onChangeParticipantSettings('2', { entity_settings: { llm_settings: { temperature: 0.9, model_name: 'gpt-4' } } });
    });

    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.temperature', 0.9);
    expect(setFieldValue).toHaveBeenCalledWith('version_details.llm_settings.model_name', 'gpt-4');
  });

  it('onChangeParticipantSettings is a no-op when updates carry no llm_settings', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ setFieldValue }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    act(() => {
      result.current.onChangeParticipantSettings('2', {});
    });
    act(() => {
      result.current.onChangeParticipantSettings('2', { entity_settings: {} });
    });

    expect(setFieldValue).not.toHaveBeenCalled();
  });

  it('onSetLLMSettings writes every field via setFieldValue', async () => {
    const client = createTestSocketClient();
    const setFieldValue = vi.fn();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
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

  it('onSelectThisParticipant and onClearActiveParticipant are safe no-ops', async () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    expect(() => act(() => result.current.onSelectThisParticipant())).not.toThrow();
    expect(() => act(() => result.current.onClearActiveParticipant())).not.toThrow();
  });

  // Uses a RESTORED conversation with an already-empty `chat_history` (no `welcome_message` on
  // the initial version details either) rather than driving `onSend`, so this test does not trip
  // `useApplicationChatConversation.hooks.ts`'s own "reset to a fresh conversation (clearing
  // `id`/`uuid`) whenever the version id changes" effect, which only fires when
  // `prev.chat_history.length` is non-zero. Both effects fire off the SAME `applicationVersionDetails?.id`
  // change; with a non-empty history that reset effect races the auto-switch trigger effect within
  // the same passive-effects flush and can make it re-fire a second time with a stale/undefined
  // `versionId`, clobbering the correct result — a genuine pre-existing interaction between two
  // effects this ported hook composes (see `useApplicationChatConversation.hooks.ts`'s own "Resets
  // to a fresh welcome-message-only history..." doc comment), not something this test suite fixes.
  it('auto-switches entity_settings and merges them into the active participant once a real conversation/participant id exist and the version changes', async () => {
    server.use(
      http.put('*/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId', () =>
        HttpResponse.json({ entity_settings: {} }),
      ),
    );
    const client = createTestSocketClient();
    const restoredConversationData = {
      id: 99,
      uuid: 'uuid-99',
      chat_history: [],
      participants: [{ id: '2', entityName: 'application' as const, entitySettings: { toolkitType: 'bar' } }],
    };
    const { result, rerender } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({
        applicationVersionDetails: { id: 5 },
        restoredConversationID: 99,
        restoredConversationData,
      }),
    });
    await waitFor(() => expect(result.current.activeConversation?.id).toBe(99));
    expect(result.current.activeParticipant?.entitySettings).toEqual({ toolkitType: 'bar' });

    rerender(baseParams({ applicationVersionDetails: { id: 6 }, restoredConversationID: 99, restoredConversationData }));

    await waitFor(() => expect(result.current.activeParticipant?.entitySettings).toMatchObject({ version_id: 6 }));
    // The replace endpoint spreads the participant's PRIOR entitySettings first, so `foo` survives the merge.
    expect(result.current.activeParticipant?.entitySettings).toMatchObject({ toolkitType: 'bar' });
  });

  it('surfaces a failed version switch without throwing (error swallowed by the switch-version hook, not onError)', async () => {
    server.use(
      http.put('*/elitea_core/entity_settings/prompt_lib/:projectId/:conversationId/:participantId', () =>
        HttpResponse.json({ error: 'nope' }, { status: 400 }),
      ),
    );
    const client = createTestSocketClient();
    const onError = vi.fn();
    const restoredConversationData = {
      id: 99,
      uuid: 'uuid-99',
      chat_history: [],
      participants: [{ id: '2', entityName: 'application' as const, entitySettings: {} }],
    };
    const { result, rerender } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({
        onError,
        applicationVersionDetails: { id: 5 },
        restoredConversationID: 99,
        restoredConversationData,
      }),
    });
    await waitFor(() => expect(result.current.activeConversation?.id).toBe(99));

    rerender(baseParams({ onError, applicationVersionDetails: { id: 7 }, restoredConversationID: 99, restoredConversationData }));

    expect(result.current.activeConversation).not.toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('passes source: "pipeline" through to conversation creation when explicitly set', async () => {
    const client = createTestSocketClient();
    const adapter = stubAdapter();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams({ adapter, source: 'pipeline' }),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({ source: 'pipeline' });
  });

  it('exposes attachments plumbing wired through from useApplicationChatConversation', async () => {
    const client = createTestSocketClient();
    const { result } = renderHook((p: UseApplicationChatParams) => useApplicationChat(p), {
      wrapper: createWrapper(client),
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    expect(result.current.attachments).toEqual([]);
    expect(typeof result.current.onAttachFiles).toBe('function');
    expect(typeof result.current.onDeleteAttachment).toBe('function');
    expect(typeof result.current.onClearAttachments).toBe('function');
  });
});
