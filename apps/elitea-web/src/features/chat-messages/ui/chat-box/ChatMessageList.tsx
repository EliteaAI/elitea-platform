/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageList.jsx` (302 lines) — renders the full message list for a
 * conversation, orchestrating individual message row rendering.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageList.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { ApplicationAnswer } from './ApplicationAnswer';
import { UserMessage } from './UserMessage';

/** @public Props for `ChatMessageList`. */
export interface ChatMessageListProps {
  /** The list of messages to render. */
  readonly chatHistory: readonly ChatMessage[];
  /** Whether a message is currently streaming. */
  readonly isStreaming?: boolean;
  /** The user ID for identifying the current user. */
  readonly userId?: string;
  /** Called when a message is copied to clipboard. */
  readonly onCopyToClipboard?: ((message: ChatMessage) => void) | undefined;
  /** Called when an AI answer is deleted. */
  readonly onDeleteAnswer?: ((messageId: string) => void) | undefined;
  /** Called when an AI answer is regenerated. */
  readonly onRegenerateAnswer?: ((messageId: string) => void) | undefined;
  /** Called when a message is submitted after editing. */
  readonly onSubmitEditedMessage?: ((message: ChatMessage) => void) | undefined;
  /** Whether auto-speak mode is active. */
  readonly autoSpeak?: boolean;
  /** Currently speaking message ID. */
  readonly speakingMessageId?: string | undefined;
  /** TTS speaking segments. */
  readonly speakingSegments?: readonly unknown[] | undefined;
  /** TTS spoken range. */
  readonly spokenRange?: { readonly start: number; readonly end: number } | undefined;
}

/**
 * `ChatMessageList` — renders the full message list for a conversation.
 * Each message is rendered according to its role (user / assistant).
 */
export function ChatMessageList({
  chatHistory,
  isStreaming = false,
  userId: _userId,
  onCopyToClipboard,
  onDeleteAnswer,
  onRegenerateAnswer,
  onSubmitEditedMessage: _onSubmitEditedMessage,
  autoSpeak: _autoSpeak,
  speakingMessageId,
  speakingSegments,
  spokenRange,
}: ChatMessageListProps): ReactNode {
  if (!chatHistory?.length) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4,
          color: 'text.secondary',
        }}
      >
        No messages yet
      </Box>
    );
  }

  return (
    <List
      data-testid="chat-message-list"
      disablePadding
      sx={{ px: 2 }}
    >
      {chatHistory.map((message) => {
        const isUser = message.role === 'user';
        const messageId = message.id;

        return (
          <Box
            key={messageId}
            data-testid="chat-message-item"
            sx={{ mb: 1 }}
          >
            {isUser ? (
              <UserMessage
                message={message}
                messageId={messageId}
                onCopy={() => onCopyToClipboard?.(message)}
                onDelete={() => {
                  // User messages can't typically be deleted in the old app
                }}
              />
            ) : (
              <ApplicationAnswer
                answer={message}
                messageId={messageId}
                onCopy={() => { onCopyToClipboard?.(message); }}
                onDelete={() => { onDeleteAnswer?.(messageId); }}
                onRegenerate={() => { onRegenerateAnswer?.(messageId); }}
                isStreaming={isStreaming}
                {...(speakingMessageId && { speakingMessageId })}
                {...(speakingSegments && { speakingSegments })}
                {...(spokenRange && { spokenRange })}
              />
            )}
          </Box>
        );
      })}
    </List>
  );
}
