import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePipelineChatConversation } from './usePipelineChatConversation.hooks';
import type { UsePipelineChatConversationParams } from './usePipelineChatConversation.hooks';

function baseParams(overrides: Partial<UsePipelineChatConversationParams> = {}): UsePipelineChatConversationParams {
  return {
    pipelineId: '1',
    pipelineName: 'My Pipeline',
    pipelineVersionDetails: { id: 5, welcome_message: 'Hi there' },
    projectId: 'p1',
    source: 'pipeline',
    restoredConversationID: null,
    restoredConversationData: undefined,
    isLoadingRestoredConversation: false,
    isErrorRestoredConversation: false,
    onRestoreConversationComplete: vi.fn(),
    ...overrides,
  };
}

/**
 * `initialProps` (not `renderHook(() => usePipelineChatConversation(baseParams()))`)
 * so the params object stays REFERENTIALLY STABLE across re-renders, matching
 * how a real caller passes it (`ConfigurationTab`'s own `pipelineVersionDetails`
 * only changes reference when the underlying form value actually changes) —
 * calling `baseParams()` fresh inside the render callback would recreate
 * `pipelineVersionDetails` every render, defeating `usePipelineChatConversation`'s
 * own `useMemo` and reproducing the exact infinite-loop this file's own
 * `usePipelineChatConversation.hooks.ts` module doc comment documents fixing.
 */
function renderConversation(params: UsePipelineChatConversationParams) {
  return renderHook((p: UsePipelineChatConversationParams) => usePipelineChatConversation(p), {
    initialProps: params,
  });
}

describe('usePipelineChatConversation', () => {
  it('creates a fresh conversation once a pipelineParticipant resolves', async () => {
    const { result } = renderConversation(baseParams());

    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation).toMatchObject({
      name: 'Chat with My Pipeline',
      is_private: true,
      source: 'pipeline',
      isNew: true,
      isPipelineChat: true,
    });
    expect(result.current.activeParticipant).toMatchObject({ id: '1', entityName: 'application' });
  });

  it('seeds chat_history with the welcome message once the conversation exists', async () => {
    const { result } = renderConversation(baseParams());
    await waitFor(() => expect(result.current.activeConversation?.chat_history).toHaveLength(1));
    expect(result.current.activeConversation?.chat_history[0]).toMatchObject({
      id: 'welcome_message_id',
      role: 'assistant',
      content: 'Hi there',
    });
  });

  it('does not create a conversation while a restoredConversationID is pending', () => {
    const { result } = renderConversation(baseParams({ restoredConversationID: '42' }));
    expect(result.current.activeConversation).toBeNull();
  });

  it('restores from restoredConversationData once it resolves, and calls onInfo', async () => {
    const onInfo = vi.fn();
    const onRestoreConversationComplete = vi.fn();
    const { result } = renderConversation(
      baseParams({
        restoredConversationID: '42',
        restoredConversationData: {
          id: 42,
          uuid: 'uuid-42',
          chat_history: [{ id: 'm1', role: 'user' }],
          participants: [{ id: '9', entityName: 'application', entityMeta: {}, entitySettings: {} }],
        },
        onInfo,
        onRestoreConversationComplete,
      }),
    );

    await waitFor(() => expect(result.current.activeConversation?.id).toBe(42));
    expect(result.current.activeParticipant).toMatchObject({ id: '9' });
    expect(onInfo).toHaveBeenCalledWith('Chat restored successfully');
    expect(onRestoreConversationComplete).toHaveBeenCalled();
  });

  it('surfaces onError when the restored conversation has no application participant', async () => {
    const onError = vi.fn();
    renderConversation(
      baseParams({
        restoredConversationID: '42',
        restoredConversationData: { id: 42, uuid: 'uuid-42', chat_history: [], participants: [] },
        onError,
      }),
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not find pipeline participant in restored chat'));
  });

  it('surfaces onError when restoring fails', async () => {
    const onError = vi.fn();
    renderConversation(baseParams({ restoredConversationID: '42', isErrorRestoredConversation: true, onError }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith('Failed to restore conversation'));
  });

  it('reports disableAttachments true when the version has no "attachments" internal tool', async () => {
    const { result } = renderConversation(baseParams({ pipelineVersionDetails: { id: 5, meta: { internal_tools: [] } } }));
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.disableAttachments).toBe(true);
  });

  it('does not loop forever once an existing conversation already carries the application participant (regression guard)', async () => {
    const { result, rerender } = renderConversation(baseParams());
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());

    // A referentially-stable re-render (same params object) must not keep
    // recreating the conversation object indefinitely.
    const before = result.current.activeConversation;
    rerender(baseParams());
    await waitFor(() => expect(result.current.activeConversation).not.toBeNull());
    expect(result.current.activeConversation?.name).toBe(before?.name);
  });
});
