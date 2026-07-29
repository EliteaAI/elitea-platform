import type { ReactNode } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { ZipDownloadProgress } from '../model/types';

export function ZipDownloadProgressDialog({
  progress,
  onCancel,
}: {
  readonly progress: ZipDownloadProgress;
  readonly onCancel: () => void;
}): ReactNode {
  const percentage = progress.total === 0 ? 0 : Math.round((progress.current / progress.total) * 100);
  return (
    <Dialog
      open={progress.open}
      onClose={onCancel}
      fullWidth
      maxWidth="xs"
    >
      <DialogTitle>{t('artifacts.zip.title', 'Preparing ZIP download')}</DialogTitle>
      <DialogContent>
        <LinearProgress
          variant="determinate"
          value={percentage}
        />
        <Typography
          variant="bodySmall"
          sx={{ mt: 1 }}
        >
          {t('artifacts.zip.progress', '{{current}} of {{total}}', {
            current: progress.current,
            total: progress.total,
          })}
          {progress.filename === '' ? '' : ` — ${progress.filename}`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
}
