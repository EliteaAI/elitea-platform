/**
 * Delete user button with confirmation dialog.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/users/DeleteUserButton.jsx`.
 */
import { memo, useCallback, useMemo, useState } from 'react';

import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { RemoveIcon } from '../icons/remove-icon';
import { combineSx } from '../lib/combineSx';
import { t } from '../lib/t';
import { DeleteEntityModal } from '../DeleteEntityModal';

export interface DeleteUserButtonProps {
  userIds: string[];
  isLoading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  sx?: SxProps<Theme>;
}

export const DeleteUserButton = memo(function DeleteUserButton({
  userIds,
  isLoading = false,
  disabled = false,
  onConfirm,
  sx,
}: DeleteUserButtonProps) {
  const [open, setOpen] = useState(false);

  const entityName = useMemo(() => {
    if (userIds.length > 1)
      return t('shared.ui.settings.users.multipleUsers', 'users');
    return t('shared.ui.settings.users.user', 'user');
  }, [userIds.length]);

  const handleDelete = useCallback(() => {
    setOpen(true);
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
  }, []);

  const handleConfirmed = useCallback(() => {
    setOpen(false);
    onConfirm();
  }, [onConfirm]);

  return (
    <>
      <Tooltip
        title={t('shared.ui.settings.users.deleteUser', 'Delete user')}
        placement="top"
      >
        <IconButton
          size="small"
          onClick={handleDelete}
          disabled={disabled || isLoading}
          sx={combineSx(sx, buttonSx)}
          aria-label={t('shared.ui.settings.users.deleteUser', 'Delete user')}
        >
          <SvgIcon
            component={RemoveIcon}
            inheritViewBox
            sx={{ width: '0.875rem', height: '0.875rem' }}
          />
        </IconButton>
      </Tooltip>
      <DeleteEntityModal
        open={open}
        name={entityName}
        onConfirm={handleConfirmed}
        onClose={handleCancel}
        copy={{
          title: t('shared.ui.settings.users.deleteUserConfirm', 'Delete user'),
          confirmText: t('shared.ui.settings.users.deleteConfirm', 'Delete'),
        }}
      />
    </>
  );
});

const buttonSx: SxProps<Theme> = {
  padding: '0.25rem',
};
