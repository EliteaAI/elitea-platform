/**
 * Profile page — replaces the old-app's `pages/UserSettings/UserSettings.jsx`
 * → `Profile.jsx` → `ProfileFormContent.jsx` chain.
 */
import { memo, useCallback, useMemo } from 'react';

import { Form, Formik, type FormikValues } from 'formik';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import { useDefaultModel } from '@/shared/lib/hooks/useDefaultModel';

import { ProfileFormContent } from './ProfileFormContent';
import {
  ProfileValidationSchema,
  serializeProfileFormData,
  type ProfileFormValues,
} from './profileUtils';

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

const ProfilePage = memo(() => {
  const { data: authorResponse, isLoading, isFetching } = useGetCurrentAuthor();
  const authorData = authorResponse?.data as AuthorData | undefined;
  const { modelList, defaultModel } = useDefaultModel();

  const initialValues = useMemo<ProfileFormValues>(
    () => serializeProfileFormData(authorData, defaultModel) as ProfileFormValues,
    [authorData, defaultModel],
  );

  const handleSubmit = useCallback(
    async (_values: FormikValues, { resetForm }: { resetForm: () => void }) => {
      // deserializeProfileFormData(values) — calls PUT /social/author
      // TODO: wire to updateCurrentAuthor mutation
      resetForm();
    },
    [],
  );

  return (
    <Box sx={styles.container}>
      <Box sx={styles.header}>
        <Typography variant="labelMedium" color="text.secondary">
          Personalization
        </Typography>
      </Box>
      <Box sx={styles.content}>
        <Formik<ProfileFormValues>
          enableReinitialize
          initialValues={initialValues}
          validationSchema={ProfileValidationSchema}
          onSubmit={handleSubmit}
        >
          <Form>
            <ProfileFormContent
              name={authorData?.name ?? ''}
              avatar={authorData?.avatar ?? ''}
              email={authorData?.email ?? ''}
              isFetching={isFetching || isLoading}
              modelList={modelList}
            />
          </Form>
        </Formik>
      </Box>
    </Box>
  );
});

ProfilePage.displayName = 'ProfilePage';

export default ProfilePage;

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
};
