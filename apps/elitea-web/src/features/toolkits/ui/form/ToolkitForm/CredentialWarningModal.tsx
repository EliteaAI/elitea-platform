import type { ReactNode } from 'react';
import { Fragment } from 'react';

import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/entities/credential-warning/ui/
 * CredentialWarningModal.jsx` (47 lines) — local port, see
 * `../../../model/credentialWarning.helpers.ts`'s own doc comment for why
 * this stays in `features/toolkits` rather than a new `entities/` slice.
 *
 * `Button.BaseBtn` -> `shared/ui`'s `BaseBtn` (same thin `MuiButton` wrapper,
 * `variant="elitea"` + `color` pair). `shared/ui/modal/BaseModal` ->
 * `shared/ui`'s `BaseModal`; the baseline's plain `actions={<>...</>}` node
 * becomes `actions={{node: <>...</>}}` (`ModalActionsOptions.node`
 * "overrides the default Cancel/Confirm action pair entirely" — the exact
 * same full-override behaviour, just wrapped one level).
 */
export interface CredentialWarningModalProps {
  readonly open: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}

export function CredentialWarningModal({ open, onConfirm, onCancel, onClose }: CredentialWarningModalProps): ReactNode {
  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={t('features.toolkits.credentialWarningModal.title', 'Credential Configuration Change')}
      content={
        <Typography variant="bodyMedium">
          {t(
            'features.toolkits.credentialWarningModal.body',
            'Changing the credential may make this toolkit non-operational for other team members who do not have a matching Private credential. Make this decision considering the potential impact on your team.',
          )}
        </Typography>
      }
      actions={{
        node: (
          <Fragment>
            <BaseBtn
              variant="elitea"
              color="secondary"
              onClick={onCancel}
            >
              {t('features.toolkits.credentialWarningModal.discard', 'Discard changes')}
            </BaseBtn>
            <BaseBtn
              variant="elitea"
              color="alarm"
              onClick={onConfirm}
            >
              {t('features.toolkits.credentialWarningModal.confirm', 'Confirm changes')}
            </BaseBtn>
          </Fragment>
        ),
      }}
    />
  );
}
