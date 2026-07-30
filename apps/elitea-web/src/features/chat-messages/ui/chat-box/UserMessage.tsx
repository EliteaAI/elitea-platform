/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx` — renders a user's message row.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';

/** @public Props for `UserMessage`. */
export interface UserMessageProps {
  /** The user message to render. */
  readonly message: ChatMessage;
  /** Message ID for tracking. */
  readonly messageId: string;
  /** Whether the message is loading/streaming. */
  readonly isLoading?: boolean;
  /** Whether the message is streaming. */
  readonly isStreaming?: boolean;
  /** Whether the message is being regenerated. */
  readonly isRegenerating?: boolean;
  /** Whether the message is the last in the list. */
  readonly isLastMessage?: boolean;
  /** Called when the user clicks the copy button. */
  readonly onCopy?: (() => void) | undefined;
  /** Called when the user clicks the edit button. */
  readonly onEdit?: (() => void) | undefined;
  /** Called when the user clicks the delete button. */
  readonly onDelete?: (() => void) | undefined;
  /** Called when the user clicks the regenerate button. */
  readonly onRegenerate?: (() => void) | undefined;
  /** Whether regeneration is currently disabled. */
  readonly shouldDisableRegenerate?: boolean;
  /** Whether to show the auto-speak button. */
  readonly showSpeakButton?: boolean;
  /** Called when the user clicks auto-speak. */
  readonly onAutoSpeak?: (() => void) | undefined;
  /** The current speaking message ID (for sync highlighting). */
  readonly speakingMessageId?: string;
  /** Current speaking segments (for TTS sync). */
  readonly speakingSegments?: readonly unknown[];
  /** Current spoken range (for TTS sync). */
  readonly spokenRange?: { readonly start: number; readonly end: number };
}

/**
 * `UserMessage` — renders a user's message content with optional action
 * buttons. Shows the user's name/avatar (from the message), the message
 * content as text, and a timestamp.
 */
export function UserMessage({
  message,
  messageId: _messageId,
  isLoading = false,
  isStreaming = false,
  onCopy: _onCopy,
  onEdit: _onEdit,
  onDelete: _onDelete,
}: UserMessageProps): ReactNode {
  return (
    <Box
      data-testid="user-message"
      sx={{
        display: 'flex',
        flexDirection: 'row-reverse',
        gap: 1,
        mb: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          maxWidth: '80%',
        }}
      >
        {message.name && (
          <Typography
            variant="caption"
            sx={{ mb: 0.5, color: 'text.secondary' }}
          >
            {message.name}
          </Typography>
        )}
        <Box
          data-testid="chat-message-item"
          sx={{
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            borderRadius: '12px 12px 4px 12px',
            px: 2,
            py: 1,
          }}
        >
          <Typography variant="body2">
            {isLoading || isStreaming ? (
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  animation: 'pulse 1.5s infinite',
                }}
              >
                Typing...
              </Box>
            ) : (
              message.content
            )}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
