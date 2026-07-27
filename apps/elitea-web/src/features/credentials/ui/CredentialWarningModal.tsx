/**
 * ui/CredentialWarningModal.tsx — confirms a credential-selection change on
 * a shared toolkit before it saves, since other team members without a
 * matching private credential would lose the toolkit. Ported from
 * `apps/elitea-ui/src/[fsd]/entities/credential-warning/ui/CredentialWarningModal.jsx`.
 *
 * `onClose` (backdrop/Escape/X) and `onCancel` (the "Discard changes"
 * button, which additionally reverts the form) are kept as two distinct
 * handlers, matching the baseline and this unit's
 * `model/useCredentialWarningModal.ts` — `BaseModal`'s own `onClose` prop
 * only drives its header close button, so the two custom action buttons are
 * supplied via `actions.node` rather than its default Cancel/Confirm pair.
 */
import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BUTTON_VARIANTS, BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';

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
      title={t('credentials.warningModal.title', 'Credential Configuration Change')}
      content={
        <Typography variant="bodyMedium">
          {t(
            'credentials.warningModal.body',
            'Changing the credential may make this toolkit non-operational for other team members who do not have a matching Private credential. Make this decision considering the potential impact on your team.',
          )}
        </Typography>
      }
      actions={{
        node: (
          <>
            <BaseBtn
              variant={BUTTON_VARIANTS.secondary}
              onClick={onCancel}
            >
              {t('credentials.warningModal.discard', 'Discard changes')}
            </BaseBtn>
            <BaseBtn
              variant={BUTTON_VARIANTS.contained}
              color="error"
              onClick={onConfirm}
            >
              {t('credentials.warningModal.confirm', 'Confirm changes')}
            </BaseBtn>
          </>
        ),
      }}
    />
  );
}
