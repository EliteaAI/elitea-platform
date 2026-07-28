import { type ReactNode, useCallback, useState } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { useToolkitDelete } from '../api/toolkits';
import { useSelectedProjectId } from '../lib/hooks/useSelectedProjectId';

/** @public */
export interface DeleteToolkitButtonProps {
  readonly toolkitId: string;
  readonly name: string | undefined;
  readonly disabled?: boolean;
  /** Fired after a successful delete — the caller decides where to navigate (baseline: `navigate(-1)` or the Toolkits/MCPs list, `DeleteToolkitButton.jsx:26-38`). */
  readonly onDeleted?: () => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/DeleteToolkitButton.jsx`.
 * Structurally the toolkits-domain mirror of `features/agents/ui/
 * DeleteApplicationButton.tsx` (unit A1g) — same disclosed deviations apply
 * here (no ambient Formik `name`/`toolkit_name`/`settings` context, explicit
 * `toolkitId`/`name` props instead; no toast, `onError` instead; no
 * `useCheckPermission`/`validatePermission`/`useDeleteConfirmationDisabled`
 * port).
 *
 * ADDITIONAL disclosed deviation: the baseline's `useDeleteToolkitMenu`
 * (a separate hook returning a menu-item descriptor for the toolkit-detail
 * page's overflow menu) is not ported as a second export — no confirmed
 * generic "entity menu item" consumer exists yet in this unit's owned
 * files; `DeleteToolkitButton` itself covers the icon-button use this
 * unit's pages need.
 */
export function DeleteToolkitButton({ toolkitId, name, disabled = false, onDeleted, onError }: DeleteToolkitButtonProps): ReactNode {
  const projectId = useSelectedProjectId();
  const { deleteToolkit } = useToolkitDelete();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  const confirmDelete = useCallback(async () => {
    if (projectId === undefined) return;
    setIsDeleting(true);
    try {
      await deleteToolkit({ projectId, toolkitId });
      setOpen(false);
      onDeleted?.();
    } catch (error) {
      onError?.(error);
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, toolkitId, deleteToolkit, onDeleted, onError]);

  return (
    <>
      <Tooltip title={t('toolkits.deleteToolkitButton.title', 'Delete toolkit')}>
        <span>
          <IconButton
            aria-label={t('toolkits.deleteToolkitButton.ariaLabel', 'delete entity')}
            color="secondary"
            onClick={openModal}
            disabled={isDeleting || disabled}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <DeleteEntityModal
        open={open}
        onClose={closeModal}
        onConfirm={() => {
          void confirmDelete();
        }}
        shouldRequestInputName
        confirming={isDeleting}
        {...(name !== undefined ? { name } : {})}
      />
    </>
  );
}
