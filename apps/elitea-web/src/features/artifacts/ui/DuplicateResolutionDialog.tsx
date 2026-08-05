import type { ReactNode } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

interface DuplicateResolutionDialogProps {
  readonly open: boolean;
  readonly filenames: readonly string[];
  readonly onCancel: () => void;
  readonly onSkip: () => void;
  readonly onReplace: () => void;
  readonly onKeepBoth: () => void;
}

export function DuplicateResolutionDialog({
  open,
  filenames,
  onCancel,
  onSkip,
  onReplace,
  onKeepBoth,
}: DuplicateResolutionDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{t('artifacts.duplicates.title', 'Files already exist')}</DialogTitle>
      <DialogContent>
        <Typography variant="bodySmall">
          {t('artifacts.duplicates.description', 'Choose how to handle these duplicate files:')}
        </Typography>
        <List dense>
          {filenames.map((filename) => (
            <ListItem key={filename}>
              <ListItemText primary={filename} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel', 'Cancel')}</Button>
        <Button onClick={onSkip}>{t('artifacts.duplicates.skip', 'Skip duplicates')}</Button>
        <Button onClick={onKeepBoth}>{t('artifacts.duplicates.keepBoth', 'Keep both')}</Button>
        <Button
          color="warning"
          variant="contained"
          onClick={onReplace}
        >
          {t('artifacts.duplicates.replace', 'Replace')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
