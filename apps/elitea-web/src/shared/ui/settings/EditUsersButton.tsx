/**
 * Edit user roles button — opens the roles dialog.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/ui/users/EditUsersButton.jsx`.
 * Uses `EditUserRolesDialog` for both single and batch edit.
 */
import { memo, useCallback, useState } from 'react';

import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { EditIcon } from '../icons/edit-icon';
import { t } from '@/shared/i18n';
import { EditUserRolesDialog } from './EditUserRolesDialog';

export interface EditUsersButtonProps {
  userIds: string[];
  /** Roles of the single user being edited (for single-user mode only). */
  userRoles?: readonly string[];
  rolesOptions: { label: string; value: string }[];
  isLoading?: boolean;
  disabled?: boolean;
  onConfirm: (roles: string[]) => void;
  sx?: SxProps<Theme>;
}

export const EditUsersButton = memo(function EditUsersButton({
  userIds: _userIds,
  userRoles: _userRoles,
  rolesOptions,
  isLoading = false,
  disabled = false,
  onConfirm,
  sx,
}: EditUsersButtonProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleDialogConfirm = useCallback(
    (roles: string[]) => {
      handleClose();
      onConfirm(roles);
    },
    [onConfirm, handleClose],
  );

  return (
    <>
      <Tooltip
        title={t('shared.ui.settings.users.editRole', 'Edit role')}
        placement="top"
      >
        <IconButton
          size="small"
          onClick={handleOpen}
          disabled={disabled || isLoading}
          sx={sx}
          aria-label={t('shared.ui.settings.users.editRole', 'Edit role')}
        >
          <SvgIcon
            component={EditIcon}
            inheritViewBox
            sx={{ width: '0.875rem', height: '0.875rem' }}
          />
        </IconButton>
      </Tooltip>
      <EditUserRolesDialog
        open={open}
        onClose={handleClose}
        rolesOptions={rolesOptions}
        originalRoles={(_userRoles as string[] | undefined) ?? []}
        onConfirm={handleDialogConfirm}
      />
    </>
  );
});
