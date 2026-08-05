/**
 * ui/CredentialsTabBar.tsx — the Save/Discard action pair on a credential's
 * create/edit screen. Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/ui/credentials-tab-bar/CredentialsTabBar.jsx`
 * (there named `CredentialTabBar`). Manifest COPY-115, PERM-022, ACT-040.
 *
 * DISCLOSED REDESIGN: this is a pure presentational component — the
 * baseline reads Formik context, `useCreateCredential`/`useUpdateCredential`,
 * `useCheckPermission`, `useNavBlocker`, and navigates via `react-router-dom`
 * directly. All of that orchestration moves to the caller
 * (`pages/credentials/CredentialForm.tsx`), which is the correct split per
 * spec §3.2 ("pages/ never fetches... data enters via a features/ hook")
 * and keeps this component testable without mounting a router or a form
 * library. `TabBarItems` (`pages/Common/Components`, old app) has no
 * confirmed equivalent in `shared/ui` yet — reproduced here as a plain flex
 * row, this component's own concern since it is only ever used once.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DiscardButton } from '@/shared/ui/DiscardButton';

export interface CredentialsTabBarProps {
  readonly isEditing: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly canSave: boolean;
  readonly isSaving?: boolean;
  readonly discardDisabled?: boolean;
}

export function CredentialsTabBar({ isEditing, onSave, onDiscard, canSave, isSaving = false, discardDisabled = false }: CredentialsTabBarProps): ReactNode {
  const saveLabel = t('credentials.tabBar.save', 'Save credential');
  const discardTitle = isEditing ? t('credentials.tabBar.discard', 'Discard') : t('credentials.tabBar.cancel', 'Cancel');

  return (
    <Box sx={containerSx}>
      <Tooltip
        title={saveLabel}
        placement="top"
      >
        <Box component="span">
          <BaseBtn
            variant="contained"
            color="primary"
            disabled={!canSave}
            onClick={onSave}
          >
            {t('credentials.tabBar.saveButton', 'Save')}
            {isSaving && (
              <CircularProgress
                size={16}
                sx={spinnerSx}
              />
            )}
          </BaseBtn>
        </Box>
      </Tooltip>
      <DiscardButton
        title={discardTitle}
        disabled={isSaving || discardDisabled}
        onDiscard={onDiscard}
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
