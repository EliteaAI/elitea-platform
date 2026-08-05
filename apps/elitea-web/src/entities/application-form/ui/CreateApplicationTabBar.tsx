import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DiscardButton } from '@/shared/ui/DiscardButton';

/**
 * `CreateApplicationTabBar` — ported from
 * `apps/elitea-ui/src/pages/Applications/Components/Applications/CreateApplicationTabBar.jsx`
 * (Wave-2 promotion pass, Part 1 file 2 of 7).
 *
 * DISCLOSED REDESIGN, same shape as `features/credentials/ui/
 * CredentialsTabBar.tsx`'s own precedent: the baseline reads Formik context
 * (`formik.dirty`/`values`), Redux (`state.pipeline?.stateValidationErrors`),
 * calls `useCreateApplication` (Redux/RTK-Query, react-router navigation),
 * `useNavBlocker`, `useIsPipelineYamlCodeDirty`
 * (`features/pipelines/flow-editor`-adjacent), and toasts on error, all
 * directly. None of that may live in `entities/` — Formik/Redux are not
 * dependencies of this app, and `entities/` may not import `features/`
 * (`no-upward-from-entities`). This is a pure presentational component: the
 * caller (a future A1/A2 feature) computes `canSave` from whatever
 * dirty/error/loading signals its own form owns and supplies `onSave`/
 * `onCancel`. `TabBarItems` (`pages/Common/Components`, baseline) has no
 * confirmed `shared/ui` equivalent yet — reproduced as a plain flex row,
 * same call `CredentialsTabBar` already made.
 */
export interface CreateApplicationTabBarProps {
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly canSave: boolean;
  readonly isSaving?: boolean;
  readonly cancelDisabled?: boolean;
  readonly saveTestId?: string;
}

export function CreateApplicationTabBar({
  onSave,
  onCancel,
  canSave,
  isSaving = false,
  cancelDisabled = false,
  saveTestId = 'agent-save-button',
}: CreateApplicationTabBarProps): ReactNode {
  return (
    <Box sx={containerSx}>
      <BaseBtn
        data-testid={saveTestId}
        variant="elitea"
        color="primary"
        disabled={!canSave || isSaving}
        onClick={onSave}
      >
        {t('entities.applicationForm.createApplicationTabBar.save', 'Save')}
        {isSaving && (
          <CircularProgress
            size={20}
            sx={spinnerSx}
          />
        )}
      </BaseBtn>
      <DiscardButton
        title={t('entities.applicationForm.createApplicationTabBar.cancel', 'Cancel')}
        disabled={isSaving || cancelDisabled}
        onDiscard={onCancel}
      />
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
});

const spinnerSx: SxProps<Theme> = (theme: Theme) => ({
  marginLeft: theme.spacing(1),
});
