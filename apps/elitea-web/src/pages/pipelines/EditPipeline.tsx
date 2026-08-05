import { useMemo, useState, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams, useSearch } from '@tanstack/react-router';
import { FormProvider } from 'react-hook-form';

import { CreateApplicationTabBar } from '@/entities/application-form';
import { ConfigurationTab } from '@/features/pipelines';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

import { pipelineDetailDisplayName, toVersionSummaries } from './lib/editPipelineMappers';
import { isPublicPipelinesProject } from './lib/isPublicPipelinesProject';
import {
  DISCLOSED_PIPELINE_CHAT_ADAPTER,
  PIPELINE_CONFIGURATION_TAB_GAP_SLOTS,
  PipelineConfigurationTabBoundary,
} from './lib/pipelineConfigurationTabGaps';
import { useCorrectUserNameInUrl } from './lib/useCorrectUserNameInUrl';
import { useEditPipelineConfigurationTabBridge } from './lib/useEditPipelineConfigurationTabBridge';
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
 *    `ChatPanel.jsx`, `AddNodeMenu.jsx`) landed later, from a sibling A2
 *    sub-unit, as `features/pipelines/ui/ConfigurationTab.tsx` — exported
 *    from that slice's `index.ts` specifically so this page could reach it
 *    (adversarial-review fix: this page used to render an unconditional
 *    empty placeholder `<Box>` here even after `ConfigurationTab` existed,
 *    leaving the entire standalone pipeline editor blank). It is now
 *    mounted for real below, wrapped in `PipelineConfigurationTabBoundary`
 *    (`./lib/pipelineConfigurationTabGaps.tsx`) — see that module's own doc
 *    comment for the three sub-gaps that boundary and its two slot/adapter
 *    stand-ins disclose (no `features/chat` slice, no promoted
 *    `features/agents` configuration panels reachable through a barrel, no
 *    app-wide `SocketClientContext.Provider` mounted anywhere yet). The
 *    flow-editor canvas itself (`EditorPanel`/`FlowEditor`) is real and
 *    live; only those three surrounding pieces are disclosed gaps.
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
 *
 * **Read-only (public-viewer) gating, save-failure feedback, and the
 * detail-404 page** (adversarial-review fixes, reproduced verbatim from
 * `pages/agents/EditApplication.tsx`'s own equivalent fix, Wave-2 unit
 * A1g): the baseline's `useViewMode()` hides the Save/Save-New-Version
 * buttons whenever the currently selected project is the public project
 * (`ApplicationTabBar.jsx:65`); this page reproduces that default via the
 * same `isPublicPipelinesProject` check `Pipelines.tsx`/`usePipelinesData.ts`
 * (this unit) already use for the identical "is the current viewing context
 * public" question — no override is threaded through a `viewMode` search
 * param because nothing in this unit's own navigation call sites
 * (`Latest`/`MyLiked`/`Trending`/`PrivatePipelinesList`) ever sets one, so
 * reading it here would not change the actual, reachable behaviour. A
 * failed save now surfaces via `useEditPipelineForm`'s `saveError`, rendered
 * as an inline `role="alert"` banner (this app has no toast infrastructure
 * — see that hook's own doc comment). A 404/400 on the pipeline-DETAIL
 * fetch itself now renders the same dedicated not-found `NoResultsMessage`
 * this file already used for an unknown version id, instead of falling
 * through to the normal edit-page shell — old app: `EditPipeline.jsx`'s
 * `shouldShowNotFoundPage = (isError && isNotFoundError(error)) ||
 * isVersionNotFound` → `<Page404 />`.
 */
export function EditPipeline(): ReactNode {
  const projectId = useSelectedProjectId();
  const params = useParams({ strict: false }) as EditPipelineParams;
  const search = useSearch({ strict: false }) as EditPipelineSearch;
  const applicationId = parseApplicationId(params.agentId);
  const requestedVersionId = params.version;

  const { detail, versions, activeVersion, isFetching, isError, isDetailNotFound } = useEditPipelineData(
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

  const { form, handleSave, isSaving, saveError } = useEditPipelineForm(detail, activeVersion, projectId, applicationId);
  const { setFieldValue, versionDetails } = useEditPipelineConfigurationTabBridge(activeVersion, form.setValue);
  // Only a setter — nothing in this page reads YAML dirtiness yet (see
  // `EditPipeline`'s own doc comment: `useSaveApplicationVersion` cannot
  // carry live node/edge state either way, so there is nothing for a
  // "block save while the canvas has unsaved YAML" check to gate here).
  const [, setIsYamlDirty] = useState(false);

  // Old app: `useViewMode.js` — `viewMode` defaults to `ViewMode.Public`
  // whenever the currently selected project equals `PUBLIC_PROJECT_ID`.
  // `ApplicationTabBar.jsx:65` only renders the Save/Save-New-Version
  // buttons when `viewMode !== ViewMode.Public` — every viewer reaching
  // this page through this unit's own public-project tabs (`Latest`/
  // `MyLiked`/`Trending`/the public "Admin" `PrivatePipelinesList`, none of
  // which pass a `viewMode` override on navigation) is a read-only viewer
  // of someone else's public pipeline, not its owner.
  const isReadOnlyView = isPublicPipelinesProject(projectId);

  if (isDetailNotFound) {
    return (
      <Box sx={pageSx}>
        <NoResultsMessage
          title={t('pages.pipelines.editPipeline.pipelineNotFound.title', 'Pipeline not found')}
          description={t(
            'pages.pipelines.editPipeline.pipelineNotFound.description',
            'This pipeline no longer exists.',
          )}
        />
      </Box>
    );
  }

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
          {!isFetching && !isReadOnlyView && (
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
          {saveError !== undefined && (
            <Typography
              role="alert"
              variant="bodyMedium"
            >
              {t('pages.pipelines.editPipeline.saveError', 'Failed to save your changes.')}
            </Typography>
          )}
          <PipelineConfigurationTabBoundary>
            <ConfigurationTab
              isFetching={isFetching}
              isError={isError}
              applicationId={applicationId}
              pipelineName={detail ? pipelineDetailDisplayName(detail) : undefined}
              versionDetails={versionDetails}
              versions={versions}
              setFieldValue={setFieldValue}
              setYamlDirty={setIsYamlDirty}
              adapter={DISCLOSED_PIPELINE_CHAT_ADAPTER}
              slots={PIPELINE_CONFIGURATION_TAB_GAP_SLOTS}
            />
          </PipelineConfigurationTabBoundary>
        </Box>
      </Box>
    </FormProvider>
  );
}
