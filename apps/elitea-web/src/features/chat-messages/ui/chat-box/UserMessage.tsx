/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx` — renders a user's message row.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 * UserMessage.jsx`.
 */
import type { ChangeEvent, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { MessageAttachmentList } from '../attachments/MessageAttachmentList';
import { UserMessageActions } from './UserMessageActions';

import type { Attachment } from '@/entities/attachment/model/types';
import type { SocialAuthorProfile } from '@/shared/api/generated/model';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';

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
  /**
   * Required to download an artifact-storage-backed attachment —
   * `NormalAttachment`'s storage branch refuses (via its error report) when
   * this is absent, so leaving it unthreaded made every storage-backed
   * download a silent no-op.
   */
  readonly projectId?: string | undefined;
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

/**
 * The signed-in user's display name, from the same `GET /social/author`
 * query every other current-user read in this app goes through
 * (`features/chat-conversation-list/ui/folders/FolderItem.tsx`'s
 * `useCurrentUserId`, `useConversationSidebar.ts:106`). React Query keys the
 * request, so one row per transcript issues it and the rest read the cache.
 *
 * The cast follows that established precedent: `getCurrentAuthor`'s declared
 * response is a `{data: SocialAuthorProfile} | {data: N401Response}` union
 * whose 401 branch is unreachable here, because `eliteaFetch` throws on a
 * non-2xx answer rather than resolving with it.
 */
function useSignedInUserName(): string {
  const query = useGetCurrentAuthor();
  const profile = query.data?.data as SocialAuthorProfile | undefined;
  return profile?.name?.trim() || profile?.email?.trim() || '';
}

/**
 * Who to caption a question with.
 *
 * `message.name` wins whenever the transcript states one — including the
 * literal "User No Longer Available" that `entities/message`'s normaliser
 * produces for an author id that resolves to nobody, which is a real fact
 * about the message and must not be overwritten.
 *
 * It is empty only when the message names no author at all, which is exactly
 * what the persisted message-list endpoint returns (see `getMessageAuthorName`
 * in `entities/message/lib/normalise.ts`). The reader is then the only
 * knowable attribution, and it is the right one: before the reload the same
 * bubble was captioned with their name off the live socket frame. `userId`
 * guards the substitution — a message that DOES name an author is never
 * re-attributed to whoever happens to be reading it.
 */
function resolveAuthorCaption(message: ChatMessage, signedInName: string): string {
  if (message.name) return message.name;
  return message.userId === undefined ? signedInName : '';
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
  projectId,
}: UserMessageProps): ReactNode {
  const signedInName = useSignedInUserName();
  const authorCaption = resolveAuthorCaption(message, signedInName);
  const questionItem = useMemo(() => findQuestionItem(message.messageItems), [message.messageItems]);
  const attachmentItems = useMemo(() => findAttachmentItems(message.messageItems), [message.messageItems]);
  const resolvedContent = useMemo(
    () => message.content || getItemTextContent(questionItem) || '',
    [message.content, questionItem],
  );

  const [value, setValue] = useState(resolvedContent);
  const [isEditing, setIsEditing] = useState(false);
  // The attachment cards report download/image failures through a callback
  // that used to be dropped on the floor here — with no toast infrastructure
  // in this app, the message row itself surfaces the last failure as an
  // inline `role="alert"` line (the same pattern
  // `pages/agents/EditApplication.tsx:336` uses for its save errors).
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const handleAttachmentError = useCallback((message: string) => {
    setAttachmentError(message);
  }, []);

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
        {authorCaption && (
          <Typography
            variant="caption"
            sx={{ mb: 0.5, color: 'text.secondary' }}
          >
            {authorCaption}
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
                {...(projectId !== undefined ? { projectId } : {})}
                onError={handleAttachmentError}
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
              {...(projectId !== undefined ? { projectId } : {})}
              onError={handleAttachmentError}
            />
            <UserMessageActions
              onCopy={onCopy}
              onEdit={onSubmit ? handleEditClick : undefined}
              onDelete={onDelete}
            />
          </>
        )}
        {attachmentError !== null && (
          <Typography
            variant="caption"
            color="error"
            role="alert"
            data-testid="attachment-error"
            sx={{ mt: 0.5 }}
          >
            {attachmentError}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
