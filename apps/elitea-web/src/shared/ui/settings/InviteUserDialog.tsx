/**
 * Dialog for inviting new users by email.
 *
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/settings/components/InviteUserDialog.jsx`.
 *
 * Deviations from baseline:
 *  - `InputBase` uses `expand: { maxRows }` for multiline.
 *  - Uses MUI `TextFieldProps` onChange shape.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { BaseBtn } from '../BaseBtn';
import { InputBase } from '../InputBase';
import { SingleSelect } from '../SingleSelect';
import { t } from '@/shared/i18n';
import type { SingleSelectOption } from '../SingleSelectMenuItem';

export interface InviteUserDialogProps {
  open: boolean;
  onClose: () => void;
  rolesOptions: SingleSelectOption[];
  onConfirm: (data: { emails: string[]; roles: string[] }) => void;
}

const EMAIL_RE =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@(([[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

function validateEmail(email: string): boolean {
  return EMAIL_RE.test(email.toLowerCase());
}

function validateEmails(emails: string[]): {
  valid: boolean;
  message: string;
} {
  const invalid = emails.filter(e => e.trim() && !validateEmail(e.trim()));
  if (invalid.length === 0) return { valid: true, message: '' };
  return {
    valid: false,
    message: `Invalid email: ${invalid.map(e => e.trim()).join(', ')}`,
  };
}

export const InviteUserDialog = ({
  open,
  onClose,
  rolesOptions,
  onConfirm,
}: InviteUserDialogProps) => {
  const [inputText, setInputText] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [helperText, setHelperText] = useState('');

  useEffect(() => {
    if (!open) {
      setInputText('');
      setSelectedRoles([]);
      setError(false);
      setHelperText('');
    }
  }, [open]);

  const emails = useMemo(
    () =>
      inputText
        .split(',')
        .map(e => e.trim())
        .filter(Boolean),
    [inputText],
  );

  const hasError = useMemo(() => {
    if (emails.length === 0) return false;
    return !validateEmails(emails).valid;
  }, [emails]);

  useEffect(() => {
    if (hasError) {
      const result = validateEmails(emails);
      setError(true);
      setHelperText(result.message);
    }
  }, [hasError, emails]);

  const handleBlur = useCallback(() => {
    const result = validateEmails(emails);
    setError(!result.valid);
    setHelperText(result.message);
  }, [emails]);

  const handleRolesChange = useCallback((value: string) => {
    setSelectedRoles(prev => {
      if (prev.includes(value)) return prev.filter(r => r !== value);
      return [...prev, value];
    });
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm({ emails, roles: selectedRoles });
    onClose();
  }, [onConfirm, onClose, emails, selectedRoles]);

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
        {t('shared.ui.settings.users.inviteUsers', 'Invite users')}
      </DialogTitle>
      <DialogContent sx={contentSx}>
        <Typography
          variant="bodyMedium"
          color="text.secondary"
        >
          {t(
            'shared.ui.settings.users.inviteUsersDescription',
            'Enter user emails (separated by comma) and select roles to define permissions for this project.',
          )}
        </Typography>
        <InputBase
          label={t('shared.ui.settings.users.emails', 'Emails')}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onBlur={handleBlur}
          expand={{ maxRows: 10 }}
          fullWidth
          required
          sx={inputSx}
        />
        {error && (
          <Typography variant="bodySmall" color="error">
            {helperText}
          </Typography>
        )}
        <SingleSelect
          value=""
          onChange={handleRolesChange}
          options={rolesOptions}
          label={t('shared.ui.settings.users.roles', 'Roles')}
          sx={selectSx}
        />
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
          disabled={emails.length === 0 || selectedRoles.length === 0 || error}
        >
          {t('shared.ui.settings.users.invite', 'Invite')}
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

const inputSx: SxProps<Theme> = {
  flex: 1,
  minHeight: '3.5rem',
};

const selectSx: SxProps<Theme> = {
  marginTop: '0.5rem',
};

const actionsSx: SxProps<Theme> = {
  padding: '1rem 1.5rem',
  gap: '0.75rem',
};
