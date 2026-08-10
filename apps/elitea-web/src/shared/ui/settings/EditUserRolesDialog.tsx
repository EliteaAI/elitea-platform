/**
 * Dialog for editing user roles.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/components/EditUserRolesDialog.jsx`.
 *
 * Deviations:
 *  - Uses MUI `Dialog` directly instead of the FSD `Modal.BaseModal`.
 *  - Uses MUI `Select` with `multiple` for role selection.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import MuiSelect from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { BaseBtn } from '../BaseBtn';
import { t } from '@/shared/i18n';
import type { SingleSelectOption } from '../SingleSelectMenuItem';

export interface EditUserRolesDialogProps {
  open: boolean;
  onClose: () => void;
  rolesOptions: SingleSelectOption[];
  originalRoles: string[];
  onConfirm: (roles: string[]) => void;
}

export const EditUserRolesDialog = ({
  open,
  onClose,
  rolesOptions,
  originalRoles,
  onConfirm,
}: EditUserRolesDialogProps) => {
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(originalRoles);

  const hasChanged = useMemo(() => {
    const a = [...selectedRoleIds].sort();
    const b = [...originalRoles].sort();
    return JSON.stringify(a) !== JSON.stringify(b);
  }, [selectedRoleIds, originalRoles]);

  useEffect(() => {
    setSelectedRoleIds(originalRoles);
  }, [open, originalRoles]);

  const handleConfirm = useCallback(() => {
    onConfirm(selectedRoleIds);
  }, [onConfirm, selectedRoleIds]);

  const handleChange = useCallback((event: unknown) => {
    const value = (event as { target: { value: unknown } }).target.value;
    setSelectedRoleIds(value as string[]);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: '31.25rem',
            maxWidth: '90vw',
          },
        },
      }}
    >
      <DialogTitle>
        {t('shared.ui.settings.users.editRoles', 'Edit roles')}
      </DialogTitle>
      <DialogContent sx={contentSx}>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
        >
          {t(
            'shared.ui.settings.users.editRolesDescription',
            'Select the roles to define user permissions for this project.',
          )}
        </Typography>
        <FormControl fullWidth>
          <InputLabel id="roles-select-label">
            {t('shared.ui.settings.users.roles', 'Roles')}
          </InputLabel>
          <MuiSelect
            labelId="roles-select-label"
            multiple
            value={selectedRoleIds}
            onChange={handleChange}
            renderValue={selected => {
              const labels = rolesOptions
                .filter(o => selected.includes(o.value))
                .map(o => o.label);
              return labels.length > 0 ? labels.join(', ') : '';
            }}
            sx={selectSx}
          >
            {rolesOptions.map(option => (
              <MenuItem
                key={option.value}
                value={option.value}
                sx={menuItemSx}
              >
                <Checkbox
                  size="small"
                  checked={selectedRoleIds.includes(option.value)}
                  sx={checkboxSx}
                />
                <Typography variant="bodyMedium">{option.label}</Typography>
              </MenuItem>
            ))}
          </MuiSelect>
        </FormControl>
      </DialogContent>
      <DialogActions sx={actionsSx}>
        <BaseBtn
          variant="secondary"
          onClick={onClose}
        >
          {t('shared.ui.baseModal.cancel', 'Cancel')}
        </BaseBtn>
        <BaseBtn
          variant="contained"
          color="primary"
          onClick={handleConfirm}
          disabled={!selectedRoleIds.length || !hasChanged}
        >
          {t('shared.ui.settings.users.save', 'Save')}
        </BaseBtn>
      </DialogActions>
    </Dialog>
  );
};

const contentSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const selectSx: SxProps<Theme> = {
  marginTop: '0.5rem',
};

const menuItemSx: SxProps<Theme> = {
  padding: '0.25rem 0.5rem',
  gap: '1rem',
};

const checkboxSx: SxProps<Theme> = {
  padding: '0.25rem',
};

const actionsSx: SxProps<Theme> = {
  padding: '1rem 1.5rem',
  gap: '0.75rem',
};
