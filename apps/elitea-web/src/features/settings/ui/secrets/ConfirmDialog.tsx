/**
 * ConfirmDialog — confirmation dialog for the secrets hide / delete actions.
 *
 * Receives all dialog state from the parent via props to avoid extra hooks.
 *
 * Delete requires the user to retype the secret's exact name before the
 * confirm button enables — ported from the baseline's `Modal
 * .DeleteEntityModal` + `shouldRequestInputName` (`apps/elitea-ui/src/
 * [fsd]/shared/ui/modal/DeleteEntityModal.jsx`, wired with
 * `shouldRequestInputName` at `SecretsTable.jsx:590-596`). Hide does not
 * require retyping — it renders as a plain confirm, matching the
 * baseline's `AlertDialog` used for the hide path (`SecretsTable.jsx:
 * 597-607`).
 *
 * This is a thin wrapper over `shared/ui`'s `DeleteEntityModal`. It used to
 * be a hand-rolled `position: fixed` `Box` stack, which had no `role`,
 * no `aria-modal`, no accessible name, no focus trap, no initial focus move
 * and no Escape handler: focus stayed on the covered table row, Tab walked
 * the obscured page behind the backdrop, and the only dismiss control was an
 * unnamed icon button. `DeleteEntityModal` composes `BaseModal`, which is a
 * real MUI `Dialog` — every one of those behaviours comes from the platform
 * instead of being re-derived here.
 */
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { t } from '@/shared/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  alertType: 'delete' | 'hide' | '';
  rowName: string;
  onClose: () => void;
  onConfirm: () => void;
}

interface DialogCopy {
  title: string;
  textContent: string;
  inline: string;
  confirmText: string;
}

/** Split out so `ConfirmDialog` itself carries no branch (§3.5 complexity budget). */
function resolveCopy(isDelete: boolean): DialogCopy {
  if (isDelete) {
    return {
      title: t('entities.secret.dialog.deleteTitle', 'Delete secret?'),
      textContent: t('entities.secret.dialog.deleteTextContent', 'Are you sure you want to delete the secret '),
      inline: t('entities.secret.dialog.deleteInline', '? This action cannot be undone.'),
      confirmText: t('entities.secret.dialog.deleteConfirm', 'Delete'),
    };
  }
  return {
    title: t('entities.secret.dialog.hideTitle', 'Hide secret?'),
    textContent: t('entities.secret.dialog.hideTextContent', 'Are you sure you want to hide the secret '),
    inline: t('entities.secret.dialog.hideInline', '? It will no longer be visible.'),
    confirmText: t('entities.secret.dialog.hideConfirm', 'Hide'),
  };
}

export function ConfirmDialog({
  open,
  alertType,
  rowName,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const isDelete = alertType === 'delete';
  const copy = resolveCopy(isDelete);

  return (
    <DeleteEntityModal
      open={open && alertType !== ''}
      onClose={onClose}
      onConfirm={onConfirm}
      name={rowName}
      shouldRequestInputName={isDelete}
      alarm={isDelete}
      copy={{
        title: copy.title,
        textContent: copy.textContent,
        confirmText: copy.confirmText,
        cancelText: t('entities.secret.dialog.cancel', 'Cancel'),
      }}
      content={{ inline: copy.inline }}
      data-testid="secret-confirm-dialog"
    />
  );
}
