import { useMemo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams, useSearch } from '@tanstack/react-router';
import { FormProvider } from 'react-hook-form';

import { CreateApplicationTabBar } from '@/entities/application-form';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import { applicationDetailDisplayName, toVersionSummaries } from './lib/editApplicationMappers';
import { useCorrectUserNameInUrl } from './lib/useCorrectUserNameInUrl';
import { useEditApplicationData } from './lib/useEditApplicationData';
import { useEditApplicationForm } from './lib/useEditApplicationForm';
import { useIsVersionNotFound } from './lib/useIsVersionNotFound';
import { useSelectedProjectId } from './lib/useSelectedProjectId';
import { useDiscardApplicationChanges } from './useDiscardApplicationChanges';

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const tabBarSx: SxProps<Theme> = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: 1,
  borderColor: 'divider',
  padding: '0 1.5rem',
  minHeight: '3rem',
};
const contentSx: SxProps<Theme> = { flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem' };

interface EditApplicationParams {
  readonly tab?: string;
  readonly agentId?: string;
  readonly version?: string;
}

interface EditApplicationSearch {
  readonly isFromCreation?: string;
}

function parseApplicationId(agentId: string | undefined): number | undefined {
  if (agentId === undefined || !/^\d+$/.test(agentId)) return undefined;
  return Number(agentId);
}

interface EditApplicationSaveBarProps {
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly isSaving: boolean;
}

/**
 * Split out purely so `useDiscardApplicationChanges` (this unit's own
 * `useFormContext()`-based hook) is called from a genuine `<FormProvider>`
 * DESCENDANT, not from `EditApplication` itself — the component that
 * CREATES the `form` instance and renders `<FormProvider>` sits ABOVE that
 * provider in the tree, so calling a context-reading hook there directly
 * would throw ("useFormContext must be used within <FormProvider>"). This
 * is also the real, correct home for the hook per this file's own doc
 * comment (the baseline's actual caller, `ApplicationTabBar`, is a
 * sibling component for the exact same reason).
 */
function EditApplicationSaveBar({ onSave, canSave, isSaving }: EditApplicationSaveBarProps) {
  const { discardApplicationChanges } = useDiscardApplicationChanges();
  return (
    <CreateApplicationTabBar
      onSave={onSave}
      onCancel={discardApplicationChanges}
      canSave={canSave}
      isSaving={isSaving}
      cancelDisabled={isSaving}
    />
  );
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/EditApplication.jsx`
 * — ROUTE-012 `/agents/:tab/:agentId` (+ optional `/:version`, ROUTE-067;
 * spec §8.1).
 *
 * The application-detail/version fetch (`useEditApplicationData`) and the
 * RHF form + imperative save (`useEditApplicationForm`) both live in
 * `./lib/` — split out of this file purely to stay under the §3.5 400-line
 * budget and the oxlint cyclomatic-complexity budget (12); see each hook's
 * own doc comment.
 *
 * **Composition gaps, disclosed:**
 *  - The baseline's `ConfigurationTab` (`Components/Applications/
 *    ConfigurationTab.jsx`) is NOT in this unit's (A1g) owned-file list —
 *    it owns the actual editable panels (instructions, tools, welcome
 *    message, advance settings, editor notes, information — the six
 *    `ApplicationConfigurationLayout` slots) and belongs to a sibling A1
 *    sub-unit. A disclosed placeholder stands in its place below.
 *  - `ApplicationTabBar`/`ApplicationControls`
 *    (`@/[fsd]/entities/application-tab-bar/ui`) were NOT promoted into any
 *    `entities/` slice (verified: no `entities/application-tab-bar`
 *    directory exists in this worktree) and are not claimed by name in this
 *    sub-unit's brief either. This page reuses the promoted
 *    `CreateApplicationTabBar` for save/discard instead — its own doc
 *    comment already documents that both the baseline's create- and
 *    edit-mode save buttons "collapse into the same presentational shape"
 *    once Formik/Redux orchestration is stripped; the real consumer of
 *    THIS unit's own `useDiscardApplicationChanges` in the baseline is in
 *    fact `ApplicationTabBar` (grepped directly — not `EditApplication.jsx`
 *    itself, which builds its OWN inline `handleDiscard`), so wiring it
 *    here is the closest faithful home available for an owned hook that
 *    would otherwise have no real call site in this unit.
 *  - Nav-blocking-when-dirty (`useNavBlocker`, baseline) is dropped: that
 *    hook is not in this unit's owned-file list and no promoted equivalent
 *    exists.
 *  - Only the version-level fields `useSaveApplicationVersion` can actually
 *    carry (`conversation_starters` here, since name/description are
 *    APPLICATION-level fields — `ApplicationUpdateRequest`, a different,
 *    not-wired-in-this-pass endpoint) are saved. See `entities/
 *    application-form/model/mutations.ts`'s own doc comment for the
 *    `tags`/`tools`/`pipeline_settings` gap on this same endpoint.
 */
export function EditApplication(): ReactNode {
  const projectId = useSelectedProjectId();
  const params = useParams({ strict: false }) as EditApplicationParams;
  const search = useSearch({ strict: false }) as EditApplicationSearch;
  const applicationId = parseApplicationId(params.agentId);
  const requestedVersionId = params.version;

  const { detail, versions, activeVersion, isFetching, isError } = useEditApplicationData(
    projectId,
    applicationId,
    requestedVersionId,
  );

  const versionSummaries = useMemo(() => toVersionSummaries(versions), [versions]);
  const isVersionMissing = useIsVersionNotFound({
    version: requestedVersionId,
    isFetching,
    isError,
    versions: versionSummaries,
    skip: search.isFromCreation === 'true',
  });

  useCorrectUserNameInUrl(detail?.name);

  const { form, handleSave, isSaving } = useEditApplicationForm(detail, activeVersion, projectId, applicationId);

  if (isVersionMissing) {
    return (
      <Box sx={pageSx}>
        <NoResultsMessage
          title={t('pages.agents.editApplication.notFound.title', 'Version not found')}
          description={t('pages.agents.editApplication.notFound.description', 'This version no longer exists.')}
        />
      </Box>
    );
  }

  return (
    <FormProvider {...form}>
      <Box sx={pageSx}>
        <Box sx={tabBarSx}>
          <Typography variant="headingSmall">
            {detail ? applicationDetailDisplayName(detail) : t('pages.agents.editApplication.title', 'Agent')}
          </Typography>
          {!isFetching && (
            <EditApplicationSaveBar
              onSave={handleSave}
              canSave={form.formState.isValid && !isSaving}
              isSaving={isSaving}
            />
          )}
        </Box>
        <Box sx={contentSx}>
          {isError && (
            <Typography
              role="alert"
              variant="bodyMedium"
            >
              {t('pages.agents.editApplication.error', 'Failed to load this agent.')}
            </Typography>
          )}
          {/* Composition gap: `Components/Applications/ConfigurationTab.jsx` is not in this unit's (A1g) owned-file list — see doc comment above. */}
          <Box data-testid="edit-application-configuration-tab-panel" />
        </Box>
      </Box>
    </FormProvider>
  );
}
