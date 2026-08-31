import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate, useSearch } from '@tanstack/react-router';

import { useArtifactBuckets, useArtifactMutations } from '@/features/artifacts';
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

/**
 * Retention is optional. An empty box means "keep objects indefinitely" —
 * the `null` the API models as no lifecycle — so only a NON-empty value is
 * validated, and it must be a whole number of days above zero (the legacy
 * form's own `min(1, 'Retention value should be greater than 0')`).
 */
export function validateRetentionDays(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return 'Retention must be a whole number of days.';
  if (parsed < 1) return 'Retention must be greater than 0.';
  return '';
}

/** `''` -> `null` (no lifecycle); otherwise the parsed day count. */
export function parseRetentionDays(raw: string): number | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : Number(trimmed);
}

/**
 * The bucket form, in BOTH its modes.
 *
 * `?bucket=<name>` switches it to edit mode — see this route's own file for
 * why editing arrives on the create path rather than at the baseline's
 * declared-but-never-mounted `/artifacts/edit-bucket`.
 *
 * **Edit does not rename.** The name field is read-only in edit mode
 * because neither API can rename a bucket: `PUT /api/v2/artifacts/buckets/
 * {projectID}/{name}` accepts `retention_days` and `is_pinned` only, and
 * the legacy `editBucket` it replaced merely reconfigured the S3 lifecycle
 * (`expiration_measure`/`expiration_value` -> `configure_bucket_lifecycle`).
 * An editable name box here would be a control that silently discards what
 * the user typed. Retention is therefore the whole of "edit a bucket", and
 * `retention_days` is the field the create path cannot set at all (`POST
 * /buckets` takes `{name}`), which is exactly why the affordance is worth
 * having.
 */
export function CreateBucket(): ReactNode {
  const navigate = useNavigate();
  // `strict: false` — this app's convention for reading route search off a
  // page component rather than a route file (see `Artifacts.tsx:58`).
  const search = useSearch({ strict: false }) as { readonly bucket?: string };
  const projectId = useSelectedProjectId();
  const mutations = useArtifactMutations(projectId);

  const editingName = search.bucket !== undefined && search.bucket !== '' ? search.bucket : undefined;
  const isEditing = editingName !== undefined;

  // Edit mode has no single-bucket GET wired in this app; the list query is
  // already cached by the page that linked here, so the current retention
  // comes off that row rather than adding a second endpoint.
  const buckets = useArtifactBuckets(isEditing ? projectId : undefined);
  const editedBucket = buckets.data?.find((bucket) => bucket.name === editingName);

  const [name, setName] = useState(editingName ?? 'new-bucket');
  const [retention, setRetention] = useState('');
  const [retentionLoaded, setRetentionLoaded] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();
  const validationError = isEditing ? '' : validateBucketName(name);
  const retentionError = validateRetentionDays(retention);

  // Seed the box from the server ONCE, when the row first resolves. Keying
  // this on `editedBucket` alone would re-seed on every list refetch and
  // wipe whatever the user had typed since.
  useEffect(() => {
    if (!isEditing || retentionLoaded || editedBucket === undefined) return;
    setRetention(editedBucket.retentionDays === null ? '' : String(editedBucket.retentionDays));
    setRetentionLoaded(true);
  }, [editedBucket, isEditing, retentionLoaded]);

  const pending = isEditing ? mutations.editBucketRetention.isPending : mutations.createBucket.isPending;

  const submit = (): void => {
    setTouched(true);
    if (validationError !== '' || retentionError !== '' || projectId === undefined) return;
    setError(undefined);
    if (isEditing) {
      void mutations.editBucketRetention
        .mutateAsync({ name: editingName, retentionDays: parseRetentionDays(retention) })
        .then(() => navigate({
          to: '/artifacts',
          search: { bucket: editingName, file: '', folder: '', shared_bucket: '' },
          replace: true,
        }))
        .catch(() => setError('Failed to update the bucket.'));
      return;
    }
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
        <Typography variant="headingMedium">
          {isEditing ? t('artifacts.edit.title', 'Edit bucket') : t('artifacts.create.title', 'New bucket')}
        </Typography>
        {error !== undefined && <Typography role="alert">{error}</Typography>}
        <TextField
          fullWidth
          label={t('common.name', 'Name')}
          value={name}
          slotProps={{ htmlInput: { maxLength: 56, readOnly: isEditing } }}
          error={touched && validationError !== ''}
          // The helper line must never collapse. It used to hold the long
          // hint until the field blurred and '' afterwards, so FormHelperText
          // vanished and the button row jumped up 22.9px — and the FIRST
          // click after typing IS that blur, so mousedown landed on the
          // button while mouseup landed 23px below it and no click event was
          // ever generated (#138). Falling back to the hint instead of ''
          // both reserves the line and keeps the naming rule on screen.
          helperText={isEditing
            ? t('artifacts.edit.nameHelp', 'A bucket cannot be renamed after it is created.')
            : touched && validationError !== ''
              ? validationError
              : t('artifacts.create.nameHelp', 'Bucket names can contain letters, numbers, and hyphens.')}
          onBlur={() => setTouched(true)}
          onChange={(event) => setName(event.target.value)}
        />
        {isEditing ? (
          <TextField
            fullWidth
            label={t('artifacts.edit.retention', 'Retention (days)')}
            value={retention}
            error={retentionError !== ''}
            helperText={retentionError !== ''
              ? retentionError
              : t('artifacts.edit.retentionHelp', 'Leave empty to keep files indefinitely.')}
            onChange={(event) => setRetention(event.target.value)}
          />
        ) : (
          <Typography variant="bodySmall">
            {t(
              'artifacts.create.retentionHelp',
              'Retention settings are managed by the storage service and are not part of the current bucket API.',
            )}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            type="submit"
            variant="contained"
            disabled={pending || validationError !== '' || retentionError !== ''}
          >
            {isEditing
              ? pending
                ? t('artifacts.edit.saving', 'Saving…')
                : t('artifacts.edit.submit', 'Save bucket')
              : pending
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
