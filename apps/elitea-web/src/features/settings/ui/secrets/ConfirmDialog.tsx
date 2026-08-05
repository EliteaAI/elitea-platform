/**
 * ConfirmDialog — inline confirmation dialog for hide / delete actions.
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
 */
import { useEffect, useState } from 'react';
import { useTheme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import CloseIcon from '@mui/icons-material/Close';

import { t } from '@/shared/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  alertType: 'delete' | 'hide' | '';
  rowName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  alertType,
  rowName,
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const theme = useTheme();
  const [inputName, setInputName] = useState('');

  useEffect(() => {
    if (!open) setInputName('');
  }, [open]);

  if (!open || !alertType) return null;

  const isDelete = alertType === 'delete';
  // Ported from the baseline's `isConfirmDisabled`
  // (`DeleteEntityModal.jsx`): confirm stays disabled until the typed name
  // matches exactly — only for delete, and only once a name is known.
  const isConfirmDisabled = isDelete && Boolean(rowName) && inputName !== rowName;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
      }}
    >
      <Box
        onClick={onClose}
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundColor: theme.vars.palette.background.interactiveTourPrompt.backdrop,
        }}
      />
      <Box
        sx={{
          position: 'relative',
          backgroundColor: 'background.paper',
          borderRadius: 'var(--el-shape-radiusMd, 8px)',
          padding: '1.5rem',
          minWidth: '20rem',
          boxShadow: `0 4px 24px ${theme.vars.palette.boxShadow.default}`,
        }}
      >
        <Typography variant="headingSmall" sx={{ marginBottom: '1rem' }}>
          {isDelete
            ? t('entities.secret.dialog.deleteTitle', 'Delete secret?')
            : t('entities.secret.dialog.hideTitle', 'Hide secret?')}
        </Typography>
        <Typography variant="bodyMedium" color="text.secondary" sx={{ marginBottom: isDelete ? '0.5rem' : '1.5rem' }}>
          {isDelete
            ? t('entities.secret.dialog.deleteContent', 'Are you sure you want to delete the secret {{name}}? This action cannot be undone.', { name: rowName })
            : t('entities.secret.dialog.hideContent', 'Are you sure you want to hide the secret {{name}}? It will no longer be visible.', { name: rowName })}
        </Typography>
        {isDelete && (
          <>
            <Typography variant="bodySmall" color="text.secondary" sx={{ marginBottom: '0.5rem' }}>
              {t('entities.secret.dialog.deleteConfirmHint', 'Enter the name to confirm.')}
            </Typography>
            <TextField
              fullWidth
              autoComplete="off"
              variant="standard"
              label={t('entities.secret.dialog.deleteInputLabel', 'Name')}
              value={inputName}
              onChange={(event) => setInputName(event.target.value)}
              sx={{ marginBottom: '1.5rem' }}
            />
          </>
        )}
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={onConfirm}
            size="small"
            color="error"
            disabled={isConfirmDisabled}
          >
            {isDelete
              ? t('entities.secret.dialog.deleteConfirm', 'Delete')
              : t('entities.secret.dialog.hideConfirm', 'Hide')}
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
