/**
 * SettingsFormProvider — the ONE save mechanism behind Settings › AI
 * Personality and Settings › Memory.
 *
 * Baseline: `EliteaUI/src/[fsd]/features/settings/ui/shared/
 * SettingsFormProvider.jsx` (same toasts: "Settings saved successfully" /
 * "Failed to save settings"). Both pages are auto-save-on-blur Formik forms
 * over one record, so the fetch, the Formik host, the PUT and the toasts live
 * here once; each page supplies only its own field layout as `children`.
 *
 * Nothing here is a second API client: the read is the generated
 * `useGetCurrentAuthor` query and the write is the generated
 * `updateCurrentAuthor` operation (both from
 * `shared/api/generated/social/social.ts`, the same endpoint pair
 * `pages/settings/Personalization.tsx` already uses), and the save
 * invalidates that query's own key so every reader re-baselines.
 *
 * LOCATION NOTE: this belongs in a neutral `ui/shared/` (as it does in the
 * baseline) rather than under `ui/ai-personality/`; it sits here only because
 * the unit that added these two pages owned no third directory. Same slice,
 * so `ui/memory/` importing it is an intra-slice import, not a cross-feature
 * one (R-L1).
 */
import type { ReactNode } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { useQueryClient } from '@tanstack/react-query';
import { Form, Formik, type FormikHelpers } from 'formik';

import { ProfileValidationSchema } from '@/features/settings/lib/profile/profileUtils';
import { t } from '@/shared/i18n';
import {
  getGetCurrentAuthorQueryKey,
  updateCurrentAuthor,
  useGetCurrentAuthor,
} from '@/shared/api/generated/social/social';

import {
  type AuthorProfile,
  type SettingsProfileFormValues,
  buildAuthorUpdate,
  serializeSettingsProfile,
} from './settingsProfileForm';

const TOAST_AUTO_HIDE_MS = 3000;

export interface SettingsFormProviderProps {
  /** The page's field layout. Rendered inside the Formik context. */
  children: ReactNode;
  /**
   * Currently-selected project id. Used only as the fallback owner of the
   * summarization model when the saved profile names no project — the
   * baseline's `selectedProjectId` argument to `serializeProfileFormData`.
   */
  projectId?: string;
}

type ToastKind = 'success' | 'error' | null;

export const SettingsFormProvider = memo(({ children, projectId }: SettingsFormProviderProps) => {
  const { data } = useGetCurrentAuthor();
  const author = data?.data as AuthorProfile | undefined;
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastKind>(null);

  const initialValues = useMemo(
    () => serializeSettingsProfile(author, projectId),
    [author, projectId],
  );

  const handleSubmit = useCallback(
    async (values: SettingsProfileFormValues, helpers: FormikHelpers<SettingsProfileFormValues>) => {
      try {
        await updateCurrentAuthor(buildAuthorUpdate(author, values));
        await queryClient.invalidateQueries({ queryKey: getGetCurrentAuthorQueryKey() });
        // Re-baseline Formik against what was just submitted so `dirty` goes
        // false — otherwise `useFormikAutoSaveOnBlur` re-submits on every
        // later blur.
        helpers.resetForm({ values });
        setToast('success');
      } catch {
        setToast('error');
      }
    },
    [author, queryClient],
  );

  const closeToast = useCallback(() => setToast(null), []);

  return (
    <>
      <Formik<SettingsProfileFormValues>
        enableReinitialize
        initialValues={initialValues}
        validationSchema={ProfileValidationSchema}
        onSubmit={handleSubmit}
      >
        <Form>{children}</Form>
      </Formik>
      <Snackbar
        open={toast !== null}
        autoHideDuration={TOAST_AUTO_HIDE_MS}
        onClose={closeToast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={closeToast}
          severity={toast === 'error' ? 'error' : 'success'}
          variant="filled"
        >
          {toast === 'error'
            ? t('settings.saveError', 'Failed to save settings')
            : t('settings.saveSuccess', 'Settings saved successfully')}
        </Alert>
      </Snackbar>
    </>
  );
});

SettingsFormProvider.displayName = 'SettingsFormProvider';
