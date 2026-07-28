import { act } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import type { TestSocketClient } from '@/shared/api/socket/testing';

import { createTestQueryClient } from '../../__tests__/testUtils';
import { useToolkitChat } from './useToolkitChat.hooks';
import type { UseToolkitChatParams, UseToolkitChatResult } from './useToolkitChat.types';

function baseParams(overrides: Partial<UseToolkitChatParams> = {}): UseToolkitChatParams {
  return {
    toolkitId: 'tk-1',
    runTool: 'search_index',
    isValidForm: true,
    toolInputVariables: { query: 'x' },
    index: undefined,
    traceNewIndex: vi.fn(),
    refetchIndexesList: vi.fn(),
    cancelIndexingCallback: vi.fn(),
    values: { type: 'github', settings: { repo: 'x' } },
    modes: [],
    onMcpAuthRequired: vi.fn(),
    modelList: [{ name: 'gpt-4o-mini', default: true }],
    defaultModel: { name: 'gpt-4o-mini', default: true },
    createConversation: vi.fn().mockResolvedValue({ data: { id: 'conv-1', uuid: 'uuid-1', participants: [] } }),
    addParticipant: vi.fn().mockResolvedValue({ data: [{ entity_name: 'toolkit', entity_meta: { id: 'tk-1' } }] }),
    stopIndexing: vi.fn().mockResolvedValue(undefined),
    buildMessagePayload: vi.fn().mockReturnValue({ user_input: 'x' }),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

/** `useToolkitChat` bottoms out at `useIndexHistory` (router + query-client + zustand) and `useSocketClient` (socket context). */
function renderToolkitChat(
  params: UseToolkitChatParams,
  client: TestSocketClient = createTestSocketClient(),
  projectId = 'proj-1',
): { readonly box: { current: UseToolkitChatResult | undefined } } {
  const box: { current: UseToolkitChatResult | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useToolkitChat(params);
    return null;
  }

  function RootComponent() {
    return (
      <SocketClientContext.Provider value={client}>
        <ProbeComponent />
      </SocketClientContext.Provider>
    );
  }

  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => projectId } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { box };
}

describe('useToolkitChat', () => {
  it('seeds chatHistory with the mode-appropriate welcome message', async () => {
    const { box } = renderToolkitChat(baseParams({ modes: ['test_tools'] }));
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current?.chatHistory).toHaveLength(1);
    expect(box.current?.chatHistory[0]?.content).toContain('Welcome!');
  });

  it('adopts defaultModel once it resolves (selectedModel starts at defaultModel already here since it is supplied synchronously)', async () => {
    const { box } = renderToolkitChat(baseParams());
    await waitFor(() => expect(box.current).toBeDefined());
    expect(box.current?.selectedModel).toEqual({ name: 'gpt-4o-mini', default: true });
  });

  it('onSelectModel updates selectedModel and resets llmSettings to the static default', async () => {
    const { box } = renderToolkitChat(baseParams());
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.onSetLLMSettings({ temperature: 0.9 });
    });
    await waitFor(() => expect(box.current?.llmSettings.temperature).toBe(0.9));

    act(() => {
      box.current?.onSelectModel({ name: 'gpt-4' });
    });

    await waitFor(() => expect(box.current?.selectedModel).toEqual({ name: 'gpt-4' }));
    expect(box.current?.llmSettings).toEqual({ temperature: 0.6, max_tokens: -1, top_k: 40 });
  });

  it('handleClearChat resets chatHistory to a single fresh welcome message', async () => {
    const { box } = renderToolkitChat(baseParams());
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.handleClearChat();
    });

    await waitFor(() => expect(box.current?.chatHistory).toHaveLength(1));
  });

  it('handleRunTool creates a conversation, builds the payload, and emits chat_predict with tool_call_input', async () => {
    const client = createTestSocketClient();
    const createConversation = vi.fn().mockResolvedValue({ data: { id: 'conv-1', uuid: 'uuid-1', participants: [] } });
    const addParticipant = vi.fn().mockResolvedValue({ data: [{ entity_name: 'toolkit', entity_meta: { id: 'tk-1' } }] });
    const buildMessagePayload = vi.fn().mockReturnValue({ user_input: 'x', project_id: 'proj-1' });

    const { box } = renderToolkitChat(baseParams({ createConversation, addParticipant, buildMessagePayload }), client);
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.handleRunTool();
    });

    await waitFor(() => expect(createConversation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.getEmitted('chat_predict')).toHaveLength(1));

    const emitted = client.getEmitted('chat_predict')[0]?.payload as { tool_call_input: { tool_name: string; tool_params: unknown } };
    expect(emitted.tool_call_input).toEqual({ tool_name: 'search_index', tool_params: { query: 'x' } });
  });

  it('does not run when isValidForm is false and the tool is not the indexing tool', async () => {
    const client = createTestSocketClient();
    const createConversation = vi.fn();
    const { box } = renderToolkitChat(baseParams({ isValidForm: false, createConversation }), client);
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.handleRunTool();
    });

    expect(createConversation).not.toHaveBeenCalled();
    expect(client.getEmitted('chat_predict')).toHaveLength(0);
  });

  it('stops running (without throwing out of executeRunTool) when createConversation rejects — createToolkitConversationWithParticipant swallows the error itself and resolves to null', async () => {
    // Faithful to the baseline: `createToolkitConversation`'s own try/catch
    // (`createToolkitConversationWithParticipant`) catches the rejection,
    // sets `isRunning(false)`, and resolves to `null` — `executeRunTool`'s
    // OUTER catch never sees this error, so no error chat message is
    // appended; the flow just continues with `currentConversation: null`.
    const client = createTestSocketClient();
    const createConversation = vi.fn().mockRejectedValue(new Error('network down'));
    const { box } = renderToolkitChat(baseParams({ createConversation }), client);
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.handleRunTool();
    });

    await waitFor(() => expect(box.current?.isRunning).toBe(false));
    expect(createConversation).toHaveBeenCalledTimes(1);
    // The emit still fires with a null conversation (no exception propagated).
    await waitFor(() => expect(client.getEmitted('chat_predict')).toHaveLength(1));
  });

  it('records a chat-history error message when the emit step itself throws (buildMessagePayload throws)', async () => {
    const client = createTestSocketClient();
    const buildMessagePayload = vi.fn().mockImplementation(() => {
      throw new Error('payload build failed');
    });
    const { box } = renderToolkitChat(baseParams({ buildMessagePayload }), client);
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.handleRunTool();
    });

    await waitFor(() => expect(box.current?.isRunning).toBe(false));
    const lastMessage = box.current?.chatHistory.at(-1);
    expect(String(lastMessage?.content)).toContain('payload build failed');
    expect(client.getEmitted('chat_predict')).toHaveLength(0);
  });

  it('onCancelIndexing calls stopIndexing, reports success, and invokes the tab-switch callback', async () => {
    const stopIndexing = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const cancelIndexingCallback = vi.fn();
    const index = { id: 'idx-1', metadata: { collection: 'my-index', task_id: 't1', state: 'in_progress' } };

    const { box } = renderToolkitChat(baseParams({ index, stopIndexing, onSuccess, cancelIndexingCallback }));
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.onCancelIndexing();
    });

    await waitFor(() => expect(stopIndexing).toHaveBeenCalledWith({ projectId: 'proj-1', toolkitId: 'tk-1', indexName: 'my-index', taskId: 't1' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('Indexing stopped successfully'));
    expect(cancelIndexingCallback).toHaveBeenCalledWith('configuration');
  });

  it('onCancelIndexing reports the error instead when stopIndexing rejects', async () => {
    const stopIndexing = vi.fn().mockRejectedValue(new Error('stop failed'));
    const onError = vi.fn();
    const index = { id: 'idx-1', metadata: { collection: 'my-index', task_id: 't1', state: 'in_progress' } };

    const { box } = renderToolkitChat(baseParams({ index, stopIndexing, onError }));
    await waitFor(() => expect(box.current).toBeDefined());

    act(() => {
      box.current?.onCancelIndexing();
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Failed to stop indexing'));
  });
});
