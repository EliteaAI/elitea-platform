import { useMemo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams, useSearch } from '@tanstack/react-router';
import { FormProvider } from 'react-hook-form';

import { CreateApplicationTabBar } from '@/entities/application-form';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import { pipelineDetailDisplayName, toVersionSummaries } from './lib/editPipelineMappers';
import { useCorrectUserNameInUrl } from './lib/useCorrectUserNameInUrl';
import { useEditPipelineData } from './lib/useEditPipelineData';
import { useEditPipelineForm } from './lib/useEditPipelineForm';
import { useIsVersionNotFound } from './lib/useIsVersionNotFound';
import { useSelectedProjectId } from './lib/useSelectedProjectId';
import { useDiscardPipelineChanges } from './useDiscardPipelineChanges';

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

interface EditPipelineParams {
  readonly tab?: string;
  readonly agentId?: string;
  readonly version?: string;
}

interface EditPipelineSearch {
  readonly isFromCreation?: string;
}

function parseApplicationId(agentId: string | undefined): number | undefined {
  if (agentId === undefined || !/^\d+$/.test(agentId)) return undefined;
  return Number(agentId);
}

interface EditPipelineSaveBarProps {
  readonly onSave: () => void;
  readonly canSave: boolean;
  readonly isSaving: boolean;
}

/**
 * Split out purely so `useDiscardPipelineChanges` (this unit's own
 * `useFormContext()`-based hook) is called from a genuine `<FormProvider>`
 * DESCENDANT, not from `EditPipeline` itself — same reasoning
 * `pages/agents/EditApplication.tsx`'s own `EditApplicationSaveBar` doc
 * comment gives in full: the component that CREATES the `form` instance and
 * renders `<FormProvider>` sits ABOVE that provider in the tree.
 */
function EditPipelineSaveBar({ onSave, canSave, isSaving }: EditPipelineSaveBarProps) {
  const { discardPipelineChanges } = useDiscardPipelineChanges();
  return (
    <CreateApplicationTabBar
      onSave={onSave}
      onCancel={discardPipelineChanges}
      canSave={canSave}
      isSaving={isSaving}
      cancelDisabled={isSaving}
      saveTestId="pipeline-save-button"
    />
  );
}

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/EditPipeline.jsx` —
 * ROUTE-020 `/pipelines/:tab/:agentId` (+ optional `/:version`,
 * ROUTE-069; spec §8.1). Structurally the pipelines-domain mirror of
 * `pages/agents/EditApplication.tsx` (Wave-2 unit A1g) — a Pipeline
 * literally IS an Application row, and this page fetches/saves through the
 * exact same `entities/application-form`/generated-client seam.
 *
 * The application-detail/version fetch (`useEditPipelineData`) and the RHF
 * form + imperative save (`useEditPipelineForm`) both live in `./lib/` —
 * split out purely to stay under the §3.5 400-line budget and the oxlint
 * cyclomatic-complexity budget (12).
 *
 * **Composition gaps, disclosed:**
 *  - The baseline's `ConfigurationTab` (`Components/ConfigurationTab.jsx`,
 *    `EditorPanel.jsx`, `FlowWrapper.jsx`, `GeneralFormPanel.jsx`,
 *    `ChatPanel.jsx`, `AddNodeMenu.jsx`) is NOT in this unit's (A2m)
 *    owned-file list — it owns the actual pipeline flow editor (nodes,
 *    edges, YAML round-trip, AI assistant panel) and belongs to a sibling
 *    A2 sub-unit (this batch's brief names `PipelineEditor.jsx`/
 *    `useEditPipeline.js`/`usePipelineCreation.js` as the cross-domain
 *    "must export via `features/pipelines/index.ts`" trio a sibling unit
 *    owns). A disclosed placeholder stands in its place below, same
 *    `data-testid` convention `pages/agents/EditApplication.tsx` establishes
 *    for its own equivalent gap.
 *  - `ApplicationTabBar`/`ApplicationControls`
 *    (`@/[fsd]/entities/application-tab-bar/ui`) were NOT promoted into any
 *    `entities/` slice (verified: no `entities/application-tab-bar`
 *    directory exists in this worktree). This page reuses the promoted
 *    `CreateApplicationTabBar` for save/discard instead, same substitution
 *    `pages/agents/EditApplication.tsx` already made — the baseline's real
 *    consumer of `useDiscardPipelineChanges`'s baseline counterpart
 *    (`useDiscardApplicationChanges`) is in fact `ApplicationTabBar`
 *    (grepped directly), so wiring it here is the closest faithful home
 *    available.
 *  - Nav-blocking-when-dirty (`useNavBlocker`, baseline) is dropped: not in
 *    this unit's owned-file list and no promoted equivalent exists.
 *  - Only the version-level fields `useSaveApplicationVersion` can actually
 *    carry (`conversation_starters` here) are saved — see `entities/
 *    application-form/model/mutations.ts`'s own doc comment for the
 *    `tags`/`tools`/`pipeline_settings` gap on this same endpoint, and
 *    `lib/editPipelineMappers.ts`'s `toVersionDraft` doc comment for the
 *    pipeline-specific doubling of that gap (no live node/edge state is
 *    reachable to send even if the endpoint could carry it).
 */
export function EditPipeline(): ReactNode {
  const projectId = useSelectedProjectId();
  const params = useParams({ strict: false }) as EditPipelineParams;
  const search = useSearch({ strict: false }) as EditPipelineSearch;
  const applicationId = parseApplicationId(params.agentId);
  const requestedVersionId = params.version;

  const { detail, versions, activeVersion, isFetching, isError } = useEditPipelineData(
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

  const { form, handleSave, isSaving } = useEditPipelineForm(detail, activeVersion, projectId, applicationId);

  if (isVersionMissing) {
    return (
      <Box sx={pageSx}>
        <NoResultsMessage
          title={t('pages.pipelines.editPipeline.notFound.title', 'Version not found')}
          description={t('pages.pipelines.editPipeline.notFound.description', 'This version no longer exists.')}
        />
      </Box>
    );
  }

  return (
    <FormProvider {...form}>
      <Box sx={pageSx}>
        <Box sx={tabBarSx}>
          <Typography variant="headingSmall">
            {detail ? pipelineDetailDisplayName(detail) : t('pages.pipelines.editPipeline.title', 'Pipeline')}
          </Typography>
          {!isFetching && (
            <EditPipelineSaveBar
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
              {t('pages.pipelines.editPipeline.error', 'Failed to load this pipeline.')}
            </Typography>
          )}
          {/* Composition gap: the pipeline flow-editor ConfigurationTab is not in this unit's (A2m) owned-file list — see doc comment above. */}
          <Box data-testid="edit-pipeline-configuration-tab-panel" />
        </Box>
      </Box>
    </FormProvider>
  );
}
