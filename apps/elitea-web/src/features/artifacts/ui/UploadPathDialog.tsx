import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { validateFolderPath } from '../lib/pathValidation';

interface UploadPathDialogProps {
  readonly open: boolean;
  readonly bucket: string;
  readonly currentPrefix: string;
  readonly onClose: () => void;
  readonly onConfirm: (path: string) => void;
}

export function UploadPathDialog({
  open,
  bucket,
  currentPrefix,
  onClose,
  onConfirm,
}: UploadPathDialogProps): ReactNode {
  const [path, setPath] = useState('');
  useEffect(() => {
    if (!open) setPath('');
  }, [open]);
  const error = validateFolderPath(path, currentPrefix);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{t('artifacts.uploadPath.title', 'Choose upload folder')}</DialogTitle>
      <DialogContent>
        <Typography
          variant="bodySmall"
          sx={{ mb: 2 }}
        >
          {t('artifacts.uploadPath.destination', 'Uploading to {{destination}}', {
            destination: `${bucket}${currentPrefix === '' ? '' : ` / ${currentPrefix}`}`,
          })}
        </Typography>
        <TextField
          fullWidth
          label={t('artifacts.uploadPath.label', 'Additional folder path')}
          placeholder={t('artifacts.uploadPath.placeholder', 'reports/2026')}
          value={path}
          error={error !== ''}
          helperText={error || t('artifacts.uploadPath.help', 'Leave empty to upload to the current folder.')}
          onChange={(event) => setPath(event.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
        <Button
          variant="contained"
          disabled={error !== ''}
          onClick={() => onConfirm(path)}
        >
          {t('common.continue', 'Continue')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
