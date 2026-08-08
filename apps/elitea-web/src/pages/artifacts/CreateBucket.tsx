import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate } from '@tanstack/react-router';

import { useArtifactMutations } from '@/features/artifacts';
import { t } from '@/shared/i18n';

import { useSelectedProjectId } from './lib/useSelectedProjectId';

const BUCKET_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9-]*$/;

export function validateBucketName(name: string): string {
  if (name.trim() === '') return 'Name is required.';
  if (name.length > 56) return 'Name must not exceed 56 characters.';
  if (!BUCKET_NAME_PATTERN.test(name)) {
    return 'Start with a letter and use only letters, numbers, and hyphens.';
  }
  return '';
}

export function CreateBucket(): ReactNode {
  const navigate = useNavigate();
  const projectId = useSelectedProjectId();
  const mutations = useArtifactMutations(projectId);
  const [name, setName] = useState('new-bucket');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();
  const validationError = validateBucketName(name);

  const submit = (): void => {
    setTouched(true);
    if (validationError !== '' || projectId === undefined) return;
    setError(undefined);
    void mutations.createBucket
      .mutateAsync(name.trim())
      .then(() => navigate({
        to: '/artifacts',
        search: { bucket: name.trim(), file: '', folder: '', shared_bucket: '' },
        replace: true,
      }))
      .catch(() => setError('Failed to create the bucket.'));
  };

  return (
    <Box sx={rootSx}>
      <Box
        component="form"
        sx={formSx}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Typography variant="headingMedium">{t('artifacts.create.title', 'New bucket')}</Typography>
        {error !== undefined && <Typography role="alert">{error}</Typography>}
        <TextField
          fullWidth
          label={t('common.name', 'Name')}
          value={name}
          slotProps={{ htmlInput: { maxLength: 56 } }}
          error={touched && validationError !== ''}
          // The helper line must never collapse. It used to hold the long
          // hint until the field blurred and '' afterwards, so FormHelperText
          // vanished and the button row jumped up 22.9px — and the FIRST
          // click after typing IS that blur, so mousedown landed on the
          // button while mouseup landed 23px below it and no click event was
          // ever generated (#138). Falling back to the hint instead of ''
          // both reserves the line and keeps the naming rule on screen.
          helperText={touched && validationError !== ''
            ? validationError
            : t('artifacts.create.nameHelp', 'Bucket names can contain letters, numbers, and hyphens.')}
          onBlur={() => setTouched(true)}
          onChange={(event) => setName(event.target.value)}
        />
        <Typography variant="bodySmall">
          {t(
            'artifacts.create.retentionHelp',
            'Retention settings are managed by the storage service and are not part of the current bucket API.',
          )}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={mutations.createBucket.isPending || validationError !== ''}
          >
            {mutations.createBucket.isPending
              ? t('artifacts.create.creating', 'Creating…')
              : t('artifacts.create.submit', 'Create bucket')}
          </Button>
          <Button onClick={() => void navigate({ to: '/artifacts' })}>{t('common.cancel', 'Cancel')}</Button>
        </Box>
      </Box>
    </Box>
  );
}

const rootSx: SxProps<Theme> = (theme) => ({
  height: '100%',
  display: 'flex',
  justifyContent: 'center',
  padding: theme.spacing(3),
  backgroundColor: theme.vars.palette.background.tabPanel,
});
const formSx: SxProps<Theme> = (theme) => ({
  width: 'min(32rem, 100%)',
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
});
