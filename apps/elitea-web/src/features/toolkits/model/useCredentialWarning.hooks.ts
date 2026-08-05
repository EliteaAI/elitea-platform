import type { RefObject } from 'react';
import { useCallback, useState } from 'react';

import { hasCredentialConfigChanged, revertCredentialFields } from './credentialWarning.helpers';
import type { CredentialWarningDetail, RevertedCredentialDetail } from './credentialWarning.helpers';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/entities/credential-warning/hooks/
 * useCredentialWarning.hooks.js` (68 lines) — see `./credentialWarning.helpers.ts`'s
 * own doc comment for why this is a local port, not a promoted `entities/`
 * slice.
 *
 * DISCLOSED REDESIGN: the baseline's `useProjectType()` (`shared/lib/hooks`,
 * `isTeam` derived from Redux project state) has no port anywhere in this
 * app — building one is a project/entities-layer concern outside this
 * sub-unit's 8-file fence. `isTeamProject` is an explicit, required
 * parameter instead; the caller (`ToolkitsOperationButtons.tsx`) resolves
 * it from whatever project context it has.
 */
export interface UseCredentialWarningParams {
  readonly isCreating?: boolean;
  readonly isTeamProject: boolean;
  readonly editToolDetail: RevertedCredentialDetail | undefined;
  readonly originalDetails: CredentialWarningDetail | undefined;
  readonly revertCredentialsRef: RefObject<(() => void) | undefined>;
  readonly setEditToolDetail?: (detail: RevertedCredentialDetail) => void;
}

export interface UseCredentialWarningResult {
  readonly showWarning: boolean;
  readonly checkBeforeSave: (saveAction: () => void) => boolean;
  readonly handlers: {
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
    readonly onClose: () => void;
  };
}

export function useCredentialWarning({
  isCreating = false,
  isTeamProject,
  editToolDetail,
  originalDetails,
  revertCredentialsRef,
  setEditToolDetail,
}: UseCredentialWarningParams): UseCredentialWarningResult {
  const [showCredentialWarning, setShowCredentialWarning] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<(() => void) | undefined>(undefined);

  const onConfirmCredentialWarning = useCallback(() => {
    setShowCredentialWarning(false);
    if (pendingSaveAction) {
      pendingSaveAction();
      setPendingSaveAction(undefined);
    }
  }, [pendingSaveAction]);

  const onCloseCredentialWarning = useCallback(() => {
    setShowCredentialWarning(false);
    setPendingSaveAction(undefined);
  }, []);

  const onCancelCredentialWarning = useCallback(() => {
    setShowCredentialWarning(false);
    setPendingSaveAction(undefined);

    revertCredentialsRef.current?.();

    if (setEditToolDetail && originalDetails && editToolDetail) {
      const reverted = revertCredentialFields(editToolDetail, originalDetails);
      if (reverted) setEditToolDetail(reverted);
    }
  }, [revertCredentialsRef, originalDetails, editToolDetail, setEditToolDetail]);

  const checkBeforeSave = useCallback(
    (saveAction: () => void): boolean => {
      if (!isCreating && isTeamProject && hasCredentialConfigChanged(editToolDetail, originalDetails)) {
        setPendingSaveAction(() => saveAction);
        setShowCredentialWarning(true);
        return false;
      }
      return true;
    },
    [isCreating, isTeamProject, editToolDetail, originalDetails],
  );

  return {
    showWarning: showCredentialWarning,
    checkBeforeSave,
    handlers: {
      onConfirm: onConfirmCredentialWarning,
      onCancel: onCancelCredentialWarning,
      onClose: onCloseCredentialWarning,
    },
  };
}
