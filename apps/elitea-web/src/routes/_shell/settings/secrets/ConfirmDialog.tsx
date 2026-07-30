/**
 * ConfirmDialog — inline confirmation dialog for hide / delete actions.
 *
 * Receives all dialog state from the parent via props to avoid extra hooks.
 */
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import CloseIcon from '@mui/icons-material/Close';

import { t } from '@/shared/ui/lib/t';

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
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  if (!open || !alertType) return null;

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
        sx={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
      />
      <Box
        sx={{
          position: 'relative',
          backgroundColor: 'background.paper',
          borderRadius: 2,
          padding: '1.5rem',
          minWidth: '20rem',
          boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
        }}
      >
        <Typography variant="headingSmall" sx={{ marginBottom: '1rem' }}>
          {alertType === 'hide'
            ? t('entities.secret.dialog.hideTitle', 'Hide secret?')
            : t('entities.secret.dialog.deleteTitle', 'Delete secret?')}
        </Typography>
        <Typography variant="bodyMedium" color="text.secondary" sx={{ marginBottom: '1.5rem' }}>
          {alertType === 'hide'
            ? t('entities.secret.dialog.hideContent', 'Are you sure you want to hide this secret? It will no longer be visible.')
            : t('entities.secret.dialog.deleteContent', 'Are you sure you want to delete this secret? This action cannot be undone.')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={onConfirm}
            size="small"
            color="error"
          >
            {alertType === 'hide'
              ? t('entities.secret.dialog.hideConfirm', 'Hide')
              : t('entities.secret.dialog.deleteConfirm', 'Delete')}
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
