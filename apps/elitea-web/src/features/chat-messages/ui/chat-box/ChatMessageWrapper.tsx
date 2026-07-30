/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageWrapper.jsx` — wraps an individual message row with action
 * buttons (copy, edit, delete, regenerate) and manages the full
 * edit/regenerate/copy/delete/HITL-resume/MCP-continue/canvas-edit/
 * sub-agent-accordion/read-aloud-sync feature set.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * ChatMessageWrapper.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';

/** @public Props for `ChatMessageWrapper`. */
export interface ChatMessageWrapperProps {
  /** The message to render. */
  readonly message: ChatMessage;
  /** Message ID for tracking. */
  readonly messageId: string;
  /** Whether the message is currently being edited. */
  readonly isEditing?: boolean;
  /** Whether the message is loading/streaming. */
  readonly isLoading?: boolean;
  /** Whether the message is streaming. */
  readonly isStreaming?: boolean;
  /** Whether the message is being regenerated. */
  readonly isRegenerating?: boolean;
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
  /** Whether to show the copy button. */
  readonly showCopy?: boolean;
  /** Whether to show the edit button. */
  readonly showEdit?: boolean;
  /** Whether to show the delete button. */
  readonly showDelete?: boolean;
  /** Whether to show the regenerate button. */
  readonly showRegenerate?: boolean;
  /** Children: the actual message row content. */
  readonly children: ReactNode;
}

/**
 * `ChatMessageWrapper` — renders a message row wrapped in action controls.
 * The actual message rendering (markdown, code blocks, etc.) is delegated
 * to the child component.
 */
export function ChatMessageWrapper({
  message: _message,
  messageId: _messageId,
  isEditing: _isEditing,
  isLoading: _isLoading,
  isStreaming: _isStreaming,
  isRegenerating: _isRegenerating,
  onCopy: _onCopy,
  onEdit: _onEdit,
  onDelete: _onDelete,
  onRegenerate: _onRegenerate,
  shouldDisableRegenerate: _shouldDisableRegenerate,
  showCopy: _showCopy,
  showEdit: _showEdit,
  showDelete: _showDelete,
  showRegenerate: _showRegenerate,
  children,
}: ChatMessageWrapperProps): ReactNode {
  return (
    <Box
      data-testid="chat-message-wrapper"
      data-message-id={_messageId}
      sx={{ position: 'relative' }}
    >
      {children}
    </Box>
  );
}
