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
 *
 * **KNOWN LIVE DUPLICATE (A7-ui adversarial-review finding, not fully
 * fixable from this file alone).** As of this fix this component IS
 * exported from `features/credentials/index.ts` (together with its
 * `useCredentialWarningModal` hook), but a byte-for-byte functional
 * duplicate — `features/toolkits/ui/form/ToolkitForm/
 * CredentialWarningModal.tsx`, driven by that slice's own
 * `model/useCredentialWarning.hooks.ts` rather than this file's
 * `useCredentialWarningModal` — is the copy actually wired to the toolkit
 * Save button (`ToolkitsOperationButtons.tsx`). That duplicate exists
 * because `features/toolkits` cannot import this file directly
 * (`no-sideways-features` — R-L1; see that copy's own doc comment, which
 * cites this exact constraint). Exporting this component does not remove
 * the duplicate: sibling `features/*` slices still cannot import each
 * other, so `features/toolkits` gained nothing new to import from.
 *
 * The two copies WILL silently drift on any future edit to either one.
 * Real fix, outside this cluster's file scope: relocate this component and
 * `useCredentialWarningModal` (and, if a shared owner wants it,
 * `CredentialWarningBanner`) out of `features/credentials` into a new
 * `entities/credential-warning/{ui,model}` slice — matching where the
 * original baseline itself placed this component (see this file's own
 * "Ported from" line above). `entities/*` is a lower FSD layer that ANY
 * `features/*` slice may legally import, which resolves the
 * `no-sideways-features` conflict at its root instead of duplicating
 * around it. Once moved: delete
 * `features/toolkits/ui/form/ToolkitForm/CredentialWarningModal.tsx` and
 * its bespoke `model/useCredentialWarning.hooks.ts`, and repoint
 * `ToolkitsOperationButtons.tsx` at the new `entities/credential-warning`
 * exports. Neither `entities/credential-warning` nor
 * `features/toolkits/ui/form/ToolkitForm/*` is in this cluster's scope, so
 * that migration is not performed here.
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
