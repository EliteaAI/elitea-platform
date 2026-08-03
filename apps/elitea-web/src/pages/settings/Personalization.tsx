// @ts-nocheck
/**
 * Personalization page (settings tab) — replaces the old-app's
 * `pages/UserSettings/UserSettings.jsx` → `Profile.jsx` →
 * `ProfileFormContent.jsx` chain.
 *
 * Wire: `handleSubmit` → `PUT /social/author` → toast on success/error.
 */
import { memo, useCallback, useMemo, useState } from 'react';

import { Form, Formik, type FormikHelpers } from 'formik';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/ui/lib/t';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import { eliteaFetch } from '@/shared/api/generated/mutator';

import { profileFeature } from '@/features/settings';
import type { ProfileFormValues } from '@/features/settings';

const { useDefaultModel, ProfileFormContent, ProfileValidationSchema, deserializeProfileFormData, serializeProfileFormData } = profileFeature;

// Shape returned by GET /social/author — SocialAuthorProfile zod schema.
interface AuthorData {
  id: string;
  name: string;
  email: string;
  avatar: string;
  description: string;
  personal_project_id: string;
  personalization?: Record<string, unknown>;
}

/** PUT /social/author — update current author profile. */
async function updateAuthorPayload(payload: {
  name?: string;
  description?: string;
  avatar?: string;
  personalization?: unknown;
}): Promise<void> {
  await eliteaFetch('/social/author', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface PersonalizationProps {
  /** Currently-selected project id — threaded down from the route. */
  projectId: string;
}

const Personalization = memo(({ projectId }: PersonalizationProps) => {
  const { data: authorResponse, isLoading, isFetching } = useGetCurrentAuthor();
  const authorData = authorResponse?.data as AuthorData | undefined;
  const { modelList, defaultModel } = useDefaultModel({ projectId });

  const initialValues = useMemo<ProfileFormValues>(
    () => serializeProfileFormData(authorData, defaultModel),
    [authorData, defaultModel],
  );

  const [isSaving, setIsSaving] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);

  const handleSubmit = useCallback(
    async (values: ProfileFormValues, _helpers: FormikHelpers<ProfileFormValues>) => {
      setIsSaving(true);
      try {
        // Build the payload matching AuthorUpdateRequest shape
        const rawPayload = deserializeProfileFormData(values);
        const personalization = rawPayload.personalization;

        const payload: Record<string, unknown> = {
          personalization,
        };

        await updateAuthorPayload(payload);

        setShowSuccessToast(true);
      } catch {
        setShowErrorToast(true);
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const handleCloseSuccessToast = useCallback(() => setShowSuccessToast(false), []);
  const handleCloseErrorToast = useCallback(() => setShowErrorToast(false), []);

  return (
    <Box sx={styles.container}>
      <Box sx={styles.header}>
        <Typography variant="labelMedium" color="text.secondary">
          {t('settings.personalization', 'Personalization')}
        </Typography>
      </Box>
      <Box sx={styles.content}>
        <Formik<ProfileFormValues>
          enableReinitialize
          initialValues={initialValues}
          validationSchema={ProfileValidationSchema}
          onSubmit={handleSubmit}
        >
          {({ isSubmitting }) => (
            <Form>
              <ProfileFormContent
                projectId={projectId}
                name={authorData?.name ?? ''}
                avatar={authorData?.avatar ?? ''}
                email={authorData?.email ?? ''}
                isFetching={isFetching || isLoading}
                modelList={modelList}
              />
              <Box sx={styles.saveBar}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={isSubmitting || isSaving}
                  startIcon={isSaving ? <CircularProgress size={16} /> : null}
                >
                  {t('settings.profile.save', 'Save changes')}
                </Button>
              </Box>
            </Form>
          )}
        </Formik>
      </Box>

      {/* Toast notifications */}
      <Snackbar
        open={showSuccessToast}
        autoHideDuration={3000}
        onClose={handleCloseSuccessToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSuccessToast} severity="success" variant="filled">
          {t('settings.profile.saveSuccess', 'Settings saved successfully')}
        </Alert>
      </Snackbar>
      <Snackbar
        open={showErrorToast}
        autoHideDuration={3000}
        onClose={handleCloseErrorToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseErrorToast} severity="error" variant="filled">
          {t('settings.profile.saveError', 'Failed to save settings')}
        </Alert>
      </Snackbar>
    </Box>
  );
});

Personalization.displayName = 'Personalization';

export default Personalization;

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
  },
  header: {
    height: '3.75rem',
    minHeight: '3.75rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 1.5rem',
    borderBottom: '0.0625rem solid',
    borderColor: 'border.table',
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  saveBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '1rem 1.5rem',
    borderTop: '0.0625rem solid',
    borderColor: 'border.table',
  },
};
