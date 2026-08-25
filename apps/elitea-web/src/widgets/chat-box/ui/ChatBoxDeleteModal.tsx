/**
 * The chat's delete-confirmation dialog, bound to `useDeleteMessageAlert`.
 *
 * Split out of `ChatBox.tsx` purely for that file's §3.5 length budget — the
 * markup, the copy and the confirm wiring are unchanged. `alert` is passed
 * whole rather than as four separate props because the four values are one
 * hook's state and only ever move together (§3.5's "group related props into
 * one slot").
 */
import type { ReactNode } from 'react';

import { t } from '@/shared/i18n';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

/** The slice of `useDeleteMessageAlert`'s return this dialog needs. */
export interface ChatBoxDeleteAlert {
  readonly isOpen: boolean;
  readonly isAllMessages: boolean;
  readonly confirmationMessage: string;
  readonly closeDialog: () => void;
  readonly confirmDelete: () => Promise<unknown> | void;
}

export interface ChatBoxDeleteModalProps {
  readonly alert: ChatBoxDeleteAlert;
}

export function ChatBoxDeleteModal({ alert }: ChatBoxDeleteModalProps): ReactNode {
  return (
    <DeleteEntityModal
      open={alert.isOpen}
      onClose={alert.closeDialog}
      onConfirm={() => { void alert.confirmDelete(); }}
      copy={{
        title: alert.isAllMessages
          ? t('widgets.chatBox.clearChatTitle', 'Clear chat')
          : t('widgets.chatBox.deleteMessageTitle', 'Delete message'),
        textContent: alert.confirmationMessage,
      }}
      content={{ inline: '' }}
      data-testid="chat-delete-confirm-dialog"
    />
  );
}
