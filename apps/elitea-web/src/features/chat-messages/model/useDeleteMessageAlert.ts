/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useDeleteMessageAlert.hooks.js` — provides a confirmation dialog
 * orchestrator for message deletion operations (single message and
 * delete-all), including the two cases' distinct confirmation copy and the
 * actual delete invocation on confirm.
 *
 * DEVIATIONS: the baseline's `setChatHistory`/`chatInput` ref/
 * `resetSessionRef`/`deleteAllRunNodes`/`onStopTTS` params drive Redux-era,
 * imperative chat-input/session-reset/TTS concerns with no new-app
 * equivalent yet and are not ported (a plain hook, not a Redux thunk) — the
 * two delete-callback params (`onDeleteChatMessage`/`onDeleteAllChatMessages`)
 * are kept since they carry the actual deletion the confirm step must
 * invoke; the caller owns clearing/refetching its own chat-history state
 * afterward.
 */
import { useCallback, useState } from 'react';

import { t } from '@/shared/i18n';

/** Sentinel `messageId` value meaning "delete every message", not one — baseline's `ALL_MESSAGES`. */
export const ALL_MESSAGES = 'ALL_MESSAGES';

/** @public Params for `useDeleteMessageAlert`. */
export interface UseDeleteMessageAlertParams {
  /** Deletes a single message by id. */
  readonly onDeleteChatMessage?: (messageId: string) => void | Promise<void>;
  /** Deletes every message in the conversation. */
  readonly onDeleteAllChatMessages?: () => void | Promise<void>;
}

/** @public Result type for `useDeleteMessageAlert`. */
export interface UseDeleteMessageAlertResult {
  /** Whether the delete confirmation dialog is open. */
  readonly isOpen: boolean;
  /** The message ID targeted for deletion, or `ALL_MESSAGES` for a delete-all — empty when not open. */
  readonly messageId: string;
  /** Whether the open dialog is the delete-all variant. */
  readonly isAllMessages: boolean;
  /** The confirmation copy for the currently-open dialog (empty when not open). */
  readonly confirmationMessage: string;
  /** Open the confirmation dialog for a single message. */
  readonly openDialog: (messageId: string) => void;
  /** Open the confirmation dialog for deleting every message. */
  readonly openDialogForAll: () => void;
  /** Close the dialog without deleting. */
  readonly closeDialog: () => void;
  /** Confirm deletion — invokes the matching delete callback, then closes the dialog. */
  readonly confirmDelete: () => Promise<void>;
}

/**
 * `useDeleteMessageAlert` — manages the state for a message deletion
 * confirmation dialog (used before calling the delete mutation), for both
 * a single message and a delete-all confirmation.
 */
export function useDeleteMessageAlert({
  onDeleteChatMessage,
  onDeleteAllChatMessages,
}: UseDeleteMessageAlertParams = {}): UseDeleteMessageAlertResult {
  const [isOpen, setIsOpen] = useState(false);
  const [messageId, setMessageId] = useState('');
  const [confirmationMessage, setConfirmationMessage] = useState('');

  const openDialog = useCallback((id: string) => {
    setMessageId(id);
    // The copy names the pair on purpose: deleting an answer also deletes the
    // question it replies to (the server pairs them), so a dialog promising
    // that one message goes would be asking consent for something else.
    setConfirmationMessage(t('chatMessages.deleteMessageAlert.singleMessageCopy', 'This also removes the question it answers, and neither can be restored. Are you sure you want to delete this message?'));
    setIsOpen(true);
  }, []);

  const openDialogForAll = useCallback(() => {
    setMessageId(ALL_MESSAGES);
    setConfirmationMessage(t('chatMessages.deleteMessageAlert.allMessagesCopy', "The deleted messages can't be restored. Are you sure to delete all the messages?"));
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setMessageId('');
    setConfirmationMessage('');
  }, []);

  const confirmDelete = useCallback(async () => {
    if (messageId === ALL_MESSAGES) {
      await onDeleteAllChatMessages?.();
    } else if (messageId) {
      await onDeleteChatMessage?.(messageId);
    }
    closeDialog();
  }, [messageId, onDeleteAllChatMessages, onDeleteChatMessage, closeDialog]);

  return {
    isOpen,
    messageId,
    isAllMessages: messageId === ALL_MESSAGES,
    confirmationMessage,
    openDialog,
    openDialogForAll,
    closeDialog,
    confirmDelete,
  };
}
