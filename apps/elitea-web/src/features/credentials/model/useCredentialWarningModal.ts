/**
 * model/useCredentialWarningModal.ts — open/pending-action state for the
 * "changing this credential may break the toolkit for teammates" warning
 * (unit A7). Ported from
 * `apps/elitea-ui/src/[fsd]/entities/credential-warning/hooks/useCredentialWarning.hooks.js`.
 *
 * DEVIATION (disclosed): the baseline reads `useProjectType()` internally
 * (`shared/lib/hooks`, a cross-cutting hook this app has no confirmed
 * equivalent for yet within this unit's ownership fence) to gate the check
 * to team projects only. Redesigned as an explicit `isTeamProject` param —
 * the caller (a toolkit-attachment form, outside this unit's scope) already
 * knows the project kind from whatever it uses to resolve the current
 * project, so this keeps the hook itself free of that cross-cutting
 * dependency rather than guessing at an import path.
 */
import { useCallback, useState } from 'react';

import { hasCredentialConfigChanged, revertCredentialFields } from '../lib/credentialWarning';
import type { ToolDetailLike } from '../lib/credentialWarning';

export interface UseCredentialWarningModalParams {
  readonly isCreating?: boolean;
  readonly isTeamProject: boolean;
  readonly editToolDetail?: ToolDetailLike;
  readonly originalDetails?: ToolDetailLike;
  /** Reverts the credential fields the CALLER's own form state holds (e.g. a Formik/react-hook-form `reset`). */
  readonly onRevertFormFields?: () => void;
  /** Reverts the credential fields in whatever local `editToolDetail`-shaped state the caller owns. */
  readonly onSetEditToolDetail?: (next: ToolDetailLike) => void;
}

export interface UseCredentialWarningModalResult {
  readonly showWarning: boolean;
  /** Returns `true` when the save may proceed immediately; `false` means the warning was shown instead and `saveAction` will run only after `onConfirm`. */
  readonly checkBeforeSave: (saveAction: () => void) => boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onClose: () => void;
}

export function useCredentialWarningModal(params: UseCredentialWarningModalParams): UseCredentialWarningModalResult {
  const { isCreating = false, isTeamProject, editToolDetail, originalDetails, onRevertFormFields, onSetEditToolDetail } = params;
  const [showWarning, setShowWarning] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<(() => void) | null>(null);

  const onConfirm = useCallback((): void => {
    setShowWarning(false);
    if (pendingSaveAction) {
      pendingSaveAction();
      setPendingSaveAction(null);
    }
  }, [pendingSaveAction]);

  const onClose = useCallback((): void => {
    setShowWarning(false);
    setPendingSaveAction(null);
  }, []);

  const onCancel = useCallback((): void => {
    setShowWarning(false);
    setPendingSaveAction(null);
    onRevertFormFields?.();
    if (onSetEditToolDetail && originalDetails && editToolDetail) {
      onSetEditToolDetail(revertCredentialFields(editToolDetail, originalDetails) ?? editToolDetail);
    }
  }, [onRevertFormFields, onSetEditToolDetail, originalDetails, editToolDetail]);

  const checkBeforeSave = useCallback(
    (saveAction: () => void): boolean => {
      if (!isCreating && isTeamProject && hasCredentialConfigChanged(editToolDetail, originalDetails)) {
        setPendingSaveAction(() => saveAction);
        setShowWarning(true);
        return false;
      }
      return true;
    },
    [isCreating, isTeamProject, editToolDetail, originalDetails],
  );

  return { showWarning, checkBeforeSave, onConfirm, onCancel, onClose };
}
