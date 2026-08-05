import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';
import { DiscardButton } from '@/shared/ui/DiscardButton';

import { ToolkitsTabBarPlaceholder } from './ToolkitsTabBarPlaceholder';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/toolkits-tab-bar/
 * ToolkitsTabBar.jsx` (Wave-2 unit A4e) — the Save/Discard tab bar shown
 * while editing an already-saved toolkit, with an extra confirmation step
 * when the embedding model is being changed while indexes exist for it.
 *
 * DISCLOSED REDESIGNS (all forced by real, verified constraints — not
 * shortcuts):
 *
 *  1. **No `eventEmitter`.** The baseline's save flow is an async
 *     round-trip through a global event bus: click Save ->
 *     `eventEmitter.emit(ToolEvents.ToolkitsUpdateToolkit, ...)` ->
 *     (some OTHER component, outside this file, validates and) ->
 *     `eventEmitter.emit(ToolEvents.SaveEvent, ValidateToolEventReason.
 *     saveLatestVersion)` -> THIS component's own listener finally calls
 *     `useToolkitEditMutation`. No `common/eventEmitter`-equivalent exists
 *     anywhere in this app (grepped: zero hits) — `entities/toolkit/ui/
 *     ToolConfigurationForm.tsx`'s own promotion-pass port already dropped
 *     this exact event-bus wiring in favour of direct prop-driven control
 *     (its own doc comment: no `ToolEvents` reference anywhere), the same
 *     precedent this file follows. `onSave` is called DIRECTLY on confirm —
 *     the caller (composing this bar alongside its own save-validation
 *     logic) decides whether/when calling it is safe, same "hasValidationErrors
 *     disables Save" gate the baseline itself already exposed as a plain
 *     prop.
 *  2. **No `useToolkitEditMutation()` call inside this file.** That hook
 *     is A4g's (`features/toolkits/api`), not yet landed as of this
 *     sub-unit's own build (verified: `src/features/toolkits/api/` has no
 *     such file). Rather than write an import to a module that does not
 *     exist yet (which would break `tsc`/the build for every sub-unit that
 *     touches this file, not just A4g's own), `onSave: () => void` is a
 *     prop — trivially reconnectable the moment A4g lands
 *     (`<ToolkitsTabBar onSave={() => { void mutateAsync(...); }} .../>`),
 *     same "caller supplies the async action, this component owns only the
 *     button/warning-modal presentation" convention `entities/application-
 *     form`'s `ApplicationSaveButton`/`CreateApplicationTabBar` already
 *     established for the identically-shaped agent/pipeline case.
 *  3. **`isIndexesAvailable` is a prop, not `useSelector(selectIndexesAvailable)`.**
 *     `features/toolkits/indexes/model/indexesStore.ts` (A4a, already
 *     landed) deliberately does NOT mirror `indexesList` into its zustand
 *     store — see that file's own doc comment ("TanStack Query removes the
 *     reason for that mirror entirely… mirroring it into a second,
 *     hand-synchronised store would be duplicate, driftable state") — so
 *     `selectIndexesAvailable` (`state.indexes.indexesList.data.length > 0`
 *     in the baseline) has no equivalent selector to read, not because A4a
 *     hasn't landed, but because its real, landed design has nothing there
 *     to select. The caller derives this from whatever indexes-list query
 *     hook it already has (`useIndexesListQuery`-equivalent,
 *     `../../indexes/api/indexesApi.ts`) and passes the boolean down.
 *  4. **`isFormDirty`/`isEmbeddingModelDirty` are props**, replacing
 *     `useFormDirtyExcluding()`/`values.settings.embedding_model !==
 *     initialValues.settings.embedding_model` — this app has no Formik
 *     dependency (see `entities/application-form`'s own precedent); the
 *     caller's react-hook-form instance computes both.
 *  5. **`shouldDisableSave` drops the baseline's third condition**
 *     (`reasonFor === ValidateToolEventReason.saveNewVersion`, a
 *     concurrent-save-new-version guard) — that flow belongs to a separate
 *     "Save As Version" button/feature not in this sub-unit's owned scope
 *     (see e.g. `features/agents/ui/SaveNewVersionButton.tsx`'s equivalent
 *     for the agent domain) and has no toolkit-domain equivalent landed to
 *     coordinate with here.
 */
export interface ToolkitsTabBarProps {
  readonly showPlaceholder?: boolean;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly isFormDirty: boolean;
  readonly isEmbeddingModelDirty?: boolean;
  readonly isIndexesAvailable?: boolean;
  readonly isSaving?: boolean;
  readonly hasNotSavedCredentials?: boolean;
  readonly hasValidationErrors?: boolean;
  readonly canSave?: boolean;
}

function ToolkitsTabBarContainer({
  onSave,
  onDiscard,
  isFormDirty,
  isEmbeddingModelDirty = false,
  isIndexesAvailable = false,
  isSaving = false,
  hasNotSavedCredentials = false,
  hasValidationErrors = false,
}: Omit<ToolkitsTabBarProps, 'showPlaceholder' | 'canSave'>): ReactNode {
  const [alertSaving, setAlertSaving] = useState(false);

  const shouldAlertSaving = useMemo(
    () => isFormDirty && isEmbeddingModelDirty && isIndexesAvailable,
    [isFormDirty, isEmbeddingModelDirty, isIndexesAvailable],
  );

  const handleConfirmSave = useCallback(() => {
    setAlertSaving(false);
    onSave();
  }, [onSave]);

  const onClickSave = useCallback(() => {
    if (shouldAlertSaving) setAlertSaving(true);
    else handleConfirmSave();
  }, [handleConfirmSave, shouldAlertSaving]);

  const onDiscardAlertChanges = useCallback(() => {
    onDiscard();
    setAlertSaving(false);
  }, [onDiscard]);

  const onCloseAlert = useCallback(() => setAlertSaving(false), []);

  const shouldDisableSave = isSaving || !isFormDirty || hasValidationErrors;

  return (
    <>
      <Box sx={containerSx}>
        <BaseBtn
          disabled={shouldDisableSave}
          variant="elitea"
          color="primary"
          onClick={onClickSave}
        >
          {hasNotSavedCredentials
            ? t('features.toolkits.toolkitsTabBar.saveCredentials', 'Save Credentials')
            : t('features.toolkits.toolkitsTabBar.save', 'Save')}
          {isSaving && (
            <CircularProgress
              size={20}
              sx={spinnerSx}
            />
          )}
        </BaseBtn>
        <DiscardButton
          disabled={isSaving || !isFormDirty}
          onDiscard={onDiscard}
        />
      </Box>

      <BaseModal
        variant="simple"
        open={alertSaving}
        title={t('features.toolkits.toolkitsTabBar.warningTitle', 'Warning!')}
        onClose={onCloseAlert}
        content={
          <Typography>
            {t(
              'features.toolkits.toolkitsTabBar.embeddingWarning',
              'Are you sure to save changes for the Embedding Model? That will make all existing indexes non-operational. Make this decision considering the potential risks.',
            )}
          </Typography>
        }
        actions={{
          node: (
            <Box sx={alertActionsSx}>
              <BaseBtn
                variant="secondary"
                onClick={onDiscardAlertChanges}
                disableRipple
              >
                {t('features.toolkits.toolkitsTabBar.discardChanges', 'Discard changes')}
              </BaseBtn>
              <BaseBtn
                variant="elitea"
                color="alarm"
                onClick={handleConfirmSave}
                disableRipple
                disabled={isSaving}
              >
                {t('features.toolkits.toolkitsTabBar.saveChanges', 'Save changes')}
              </BaseBtn>
            </Box>
          ),
        }}
      />
    </>
  );
}

export function ToolkitsTabBar({ showPlaceholder = false, canSave = true, ...containerProps }: ToolkitsTabBarProps): ReactNode {
  if (showPlaceholder) {
    return (
      <ToolkitsTabBarPlaceholder
        onSave={containerProps.onSave}
        onDiscard={containerProps.onDiscard}
        isFormDirty={containerProps.isFormDirty}
        canSave={canSave}
        {...(containerProps.isSaving !== undefined && { isSaving: containerProps.isSaving })}
      />
    );
  }
  return <ToolkitsTabBarContainer {...containerProps} />;
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) });

const spinnerSx: SxProps<Theme> = (theme: Theme) => ({ marginLeft: theme.spacing(1) });

const alertActionsSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', gap: theme.spacing(2) });
