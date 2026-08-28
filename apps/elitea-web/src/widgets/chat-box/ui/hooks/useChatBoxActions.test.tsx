import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChatBoxActions } from './useChatBoxActions';
import type { UseChatBoxActionsParams } from './useChatBoxActions';

type OnConversationCreated = NonNullable<UseChatBoxActionsParams['onConversationCreated']>;

function renderActions(
  sendQuestion: ReturnType<typeof vi.fn>,
  onConversationCreated: OnConversationCreated,
) {
  return renderHook(() =>
    useChatBoxActions({
      chatInputRef: { current: { reset: vi.fn(), setValue: vi.fn() } },
      data: {
        hasPendingHitlInterrupt: false,
        attachments: { state: { attachments: [], onClearAttachments: vi.fn() } },
      } as never,
      state: {
        isActiveParticipantBroken: false,
        isMentioningEveryone: false,
        selectedUsers: [],
        users: [],
        setIsMentioningEveryone: vi.fn(),
        setSelectedUsers: vi.fn(),
        slash: { resetSlash: vi.fn() },
      } as never,
      handlers: { sendQuestion } as never,
      deleteAlert: {} as never,
      messages: [],
      isAgentsPage: false,
      readAloudStop: vi.fn(),
      onConversationCreated,
    }),
  );
}

describe('useChatBoxActions new-conversation promotion', () => {
  it('publishes the created conversation after the first turn starts', async () => {
    const createdConversation = { id: '503', uuid: 'conversation-uuid' };
    const sendQuestion = vi.fn().mockResolvedValue({ success: true, createdConversation });
    const onConversationCreated = vi.fn<OnConversationCreated>();
    const { result } = renderActions(sendQuestion, onConversationCreated);

    act(() => result.current.handleSend('first turn'));

    await waitFor(() => expect(onConversationCreated).toHaveBeenCalledWith(createdConversation));
  });

  it('does not publish a conversation for a failed turn', async () => {
    const sendQuestion = vi.fn().mockResolvedValue({ success: false });
    const onConversationCreated = vi.fn<OnConversationCreated>();
    const { result } = renderActions(sendQuestion, onConversationCreated);

    act(() => result.current.handleSend('failed turn'));

    await waitFor(() => expect(sendQuestion).toHaveBeenCalledTimes(1));
    expect(onConversationCreated).not.toHaveBeenCalled();
  });
});
