import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import SvgIcon from '@mui/material/SvgIcon';

import { BaseBtn } from '../BaseBtn';
import { AttentionIcon } from '../icons/attention-icon';
import { BaseModal } from '../BaseModal';
import { t } from '../lib/t';

/** @public shared/ui component API — consumed once a features/widgets/pages caller exists (none does yet in this pass). */
export interface DiscardButtonProps {
  title?: string;
  alertContent?: string;
  onDiscard: () => void;
  disabled?: boolean;
  /** Shows the confirm modal's confirm button as busy and disables it. */
  discarding?: boolean;
  /** Replaces the baseline's `useSelector(state => state.applications).isSaving` read — see the DI note below. */
  isSaving?: boolean;
  color?: 'primary' | 'secondary' | 'tertiary' | 'alarm';
  'data-testid'?: string;
}

/**
 * A "Discard" button that confirms through a warning modal before firing.
 * Ported from `apps/elitea-ui/src/[fsd]/shared/ui/button/DiscardButton.jsx`.
 * Colour/geometry come from `shared/brand/mui-overrides/MuiButton.ts`'s
 * `elitea` entries (unit S1 Part B) — this component owns no
 * `styled()`/variant styling of its own. The confirm modal reuses this
 * unit's own `BaseModal`.
 *
 * DEPENDENCY-INJECTION DEVIATION (deliberate, documented): the baseline
 * reads `isSaving` off `useSelector(state => state.applications)` directly.
 * `shared/ui` cannot import the Redux store (an architecture-layer
 * violation — the store is application state, `shared/` sits beneath every
 * other layer), so this takes an `isSaving?: boolean` prop instead; a
 * caller wires it to whatever store slice tracks the in-flight save.
 */
export function DiscardButton({
  title,
  alertContent,
  onDiscard,
  disabled,
  discarding,
  isSaving,
  color = 'secondary',
  'data-testid': dataTestId,
}: DiscardButtonProps): ReactNode {
  const [openAlert, setOpenAlert] = useState(false);

  const onOpenAlert = useCallback(() => setOpenAlert(true), []);
  const onCloseAlert = useCallback(() => setOpenAlert(false), []);
  const onConfirmDiscard = useCallback(() => {
    onCloseAlert();
    onDiscard();
  }, [onCloseAlert, onDiscard]);

  return (
    <>
      <BaseBtn
        variant="elitea"
        color={color}
        disabled={disabled || isSaving}
        onClick={onOpenAlert}
        data-testid={dataTestId}
      >
        {title ?? t('shared.ui.discardButton.title', 'Discard')}
      </BaseBtn>
      <BaseModal
        variant="simple"
        open={openAlert}
        onClose={onCloseAlert}
        onConfirm={onConfirmDiscard}
        title={t('shared.ui.discardButton.warningTitle', 'Warning')}
        content={alertContent ?? t('shared.ui.discardButton.warningContent', 'Are you sure you want to discard changes?')}
        header={{
          icon: (
            <SvgIcon
              component={AttentionIcon}
              inheritViewBox
              sx={{ width: '1.5rem', height: '1.5rem' }}
            />
          ),
        }}
        actions={{
          confirmText: t('shared.ui.discardButton.confirm', 'Discard'),
          alarm: true,
          // `exactOptionalPropertyTypes` forbids passing `confirming:
          // undefined` explicitly — the key must be absent, not present-with-undefined.
          ...(discarding !== undefined ? { confirming: discarding } : {}),
        }}
      />
    </>
  );
}
