/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useDeleteMessageAlert.hooks.js` — provides a confirmation dialog
 * state for message deletion operations.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/lib/hooks/
 * useDeleteMessageAlert.hooks.js`.
 */
import { useCallback, useState } from 'react';

/** @public Result type for `useDeleteMessageAlert`. */
export interface UseDeleteMessageAlertResult {
  /** Whether the delete confirmation dialog is open. */
  readonly isOpen: boolean;
  /** The message ID targeted for deletion (empty if not open). */
  readonly messageId: string;
  /** Open the confirmation dialog for the given message. */
  readonly openDialog: (messageId: string) => void;
  /** Close the dialog without deleting. */
  readonly closeDialog: () => void;
  /** Confirm deletion — closes the dialog and returns true. */
  readonly confirmDelete: () => boolean;
}

/**
 * `useDeleteMessageAlert` — manages the state for a message deletion
 * confirmation dialog (used before calling the delete mutation).
 */
export function useDeleteMessageAlert(): UseDeleteMessageAlertResult {
  const [isOpen, setIsOpen] = useState(false);
  const [messageId, setMessageId] = useState('');

  const openDialog = useCallback((id: string) => {
    setMessageId(id);
    setIsOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setIsOpen(false);
    setMessageId('');
  }, []);

  const confirmDelete = useCallback(() => {
    setIsOpen(false);
    setMessageId('');
    return true;
  }, []);

  return { isOpen, messageId, openDialog, closeDialog, confirmDelete };
}
