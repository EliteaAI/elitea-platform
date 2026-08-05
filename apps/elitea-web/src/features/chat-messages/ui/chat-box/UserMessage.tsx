/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx` — renders a user's message row.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx`.
 */
import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { MessageAttachmentList } from '../attachments/MessageAttachmentList';

import type { Attachment } from '@/entities/attachment/model/types';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';

const TEXT_MESSAGE_ITEM_TYPE = 'text_message';
const ATTACHMENT_ITEM_TYPE = 'attachment_message';

/** A single updated message item sent to `onSubmit` on save (baseline: `updatedItems`). */
export interface UserMessageUpdatedItem {
  readonly uuid?: string | undefined;
  readonly content: string;
  readonly item_type: string;
}

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
  /** Called (in addition to entering local edit mode) when the user clicks the edit button. */
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
  /**
   * Called with `(messageId, updatedItems)` when the user saves an edit —
   * also gates whether the Edit button/edit flow is offered at all
   * (baseline: `verticalMode && onSubmit`).
   */
  readonly onSubmit?: ((messageId: string, updatedItems: readonly UserMessageUpdatedItem[]) => void) | undefined;
  /** Called when the user confirms removing an attachment from this message. */
  readonly onRemoveAttachment?: ((fileName: string, fromStorage: boolean) => void) | undefined;
}

/**
 * `messageItems`' declared type (`MessageItemWire[]`) only models `id`/
 * `item_details.content` — the real wire also carries `item_type`/`uuid`,
 * read here the same defensive way `convertMessagesToChatHistory.ts` does.
 */
function getRawMessageItems(messageItems: ChatMessage['messageItems']): ReadonlyArray<Record<string, unknown>> {
  return (messageItems ?? []) as unknown as ReadonlyArray<Record<string, unknown>>;
}

/** Finds the `text_message` item within a message's raw `messageItems` (baseline: `questionItem`). */
function findQuestionItem(messageItems: ChatMessage['messageItems']): Record<string, unknown> | undefined {
  return getRawMessageItems(messageItems).find((item) => item.item_type === TEXT_MESSAGE_ITEM_TYPE);
}

/** Filters a message's raw `messageItems` down to attachment-typed items (baseline: `attachmentItems`). */
function findAttachmentItems(messageItems: ChatMessage['messageItems']): readonly Attachment[] {
  const items = getRawMessageItems(messageItems).filter((item) => item.item_type === ATTACHMENT_ITEM_TYPE);
  return items as unknown as readonly Attachment[];
}

/** Reads the text content nested in a `text_message` item's `item_details.content`. */
function getItemTextContent(item: Record<string, unknown> | undefined): string | undefined {
  const details = item?.item_details as { content?: string } | undefined;
  return details?.content;
}

/** The hover-revealed Copy/Edit/Delete action row — each button only renders when its handler is supplied. */
function UserMessageActions({
  onCopy,
  onEdit,
  onDelete,
}: {
  readonly onCopy?: (() => void) | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}): ReactNode {
  return (
    <Box className="actionButtons" sx={{ display: 'flex', gap: 0.5, mt: 0.5, visibility: 'hidden' }}>
      {onCopy && (
        // eslint-disable-next-line i18next/no-literal-string — tooltip label
        <Tooltip title="Copy to clipboard" placement="top">
          <IconButton
            size="small"
            color="tertiary"
            onClick={onCopy}
            // eslint-disable-next-line i18next/no-literal-string — accessible name
            aria-label="Copy to clipboard"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {onEdit && (
        // eslint-disable-next-line i18next/no-literal-string — tooltip label
        <Tooltip title="Edit the message and regenerate answer" placement="top">
          <IconButton
            size="small"
            color="tertiary"
            onClick={onEdit}
            // eslint-disable-next-line i18next/no-literal-string — accessible name
            aria-label="Edit the message and regenerate answer"
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {onDelete && (
        // eslint-disable-next-line i18next/no-literal-string — tooltip label
        <Tooltip title="Delete" placement="top">
          <IconButton
            size="small"
            color="tertiary"
            onClick={onDelete}
            // eslint-disable-next-line i18next/no-literal-string — accessible name
            aria-label="Delete"
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}

/**
 * `UserMessage` — renders a user's message content with optional action
 * buttons (copy/edit/delete), an edit-and-resubmit flow, and attachments.
 * Shows the user's name (from the message), the message content as text,
 * and — when `onSubmit` is supplied — an Edit button that swaps the bubble
 * for a textarea with Save/Cancel actions.
 */
export function UserMessage({
  message,
  messageId,
  isLoading = false,
  isStreaming = false,
  onCopy,
  onEdit,
  onDelete,
  onSubmit,
  onRemoveAttachment,
}: UserMessageProps): ReactNode {
  const questionItem = useMemo(() => findQuestionItem(message.messageItems), [message.messageItems]);
  const attachmentItems = useMemo(() => findAttachmentItems(message.messageItems), [message.messageItems]);
  const resolvedContent = useMemo(
    () => message.content || getItemTextContent(questionItem) || '',
    [message.content, questionItem],
  );

  const [value, setValue] = useState(resolvedContent);
  const [isEditing, setIsEditing] = useState(false);

  const handleEditClick = useCallback(() => {
    setValue(resolvedContent);
    setIsEditing(true);
    onEdit?.();
  }, [resolvedContent, onEdit]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setValue(resolvedContent);
  }, [resolvedContent]);

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    setValue(event.target.value);
  }, []);

  const handleSubmit = useCallback(() => {
    const updatedItems: readonly UserMessageUpdatedItem[] = questionItem
      ? [{ uuid: questionItem.uuid as string | undefined, content: value, item_type: TEXT_MESSAGE_ITEM_TYPE }]
      : [];
    setIsEditing(false);
    onSubmit?.(messageId, updatedItems);
  }, [messageId, onSubmit, questionItem, value]);

  return (
    <Box
      data-testid="user-message"
      sx={{
        display: 'flex',
        flexDirection: 'row-reverse',
        gap: 1,
        mb: 1,
        '&:hover .actionButtons': { visibility: 'visible' },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          maxWidth: '80%',
          width: isEditing ? '100%' : undefined,
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
        {isEditing ? (
          <Box sx={{ width: '100%' }}>
            <TextField
              value={value}
              onChange={handleChange}
              multiline
              maxRows={15}
              fullWidth
              size="small"
              variant="standard"
              slotProps={{ input: { disableUnderline: true } }}
              sx={(theme) => ({
                borderRadius: theme.vars.shape.radiusMd,
                border: `1px solid ${theme.vars.palette.border.userMessageEditor}`,
                background: theme.vars.palette.background.userInputBackground,
                px: 1.5,
                py: 1,
              })}
            />
            {attachmentItems.length > 0 && (
              <MessageAttachmentList
                items={attachmentItems}
                {...(onRemoveAttachment !== undefined ? { onRemoveAttachment } : {})}
              />
            )}
            <Box sx={{ display: 'flex', flexDirection: 'row-reverse', gap: 1, mt: 1 }}>
              <Button
                size="small"
                variant="contained"
                disabled={value === resolvedContent || !value.trim()}
                onClick={handleSubmit}
              >
                {/* eslint-disable-next-line i18next/no-literal-string — edit action label */}
                Save and apply
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={handleCancel}
              >
                {/* eslint-disable-next-line i18next/no-literal-string — edit action label */}
                Cancel
              </Button>
            </Box>
          </Box>
        ) : (
          <>
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
                  resolvedContent
                )}
              </Typography>
            </Box>
            <MessageAttachmentList
              items={attachmentItems}
              {...(onRemoveAttachment !== undefined ? { onRemoveAttachment } : {})}
            />
            <UserMessageActions
              onCopy={onCopy}
              onEdit={onSubmit ? handleEditClick : undefined}
              onDelete={onDelete}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
