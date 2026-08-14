import { useMemo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams, useSearch } from '@tanstack/react-router';
import { FormProvider } from 'react-hook-form';

import { CreateApplicationTabBar } from '@/entities/application-form';
import { AgentVersionControls, CreateAgentForm } from '@/features/agents';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { useUnsavedChangesNavBlocker } from '@/widgets/app-shell';

import { applicationDetailDisplayName, toVersionSummaries } from './lib/editApplicationMappers';
import { isPublicAgentsProject } from './lib/isPublicAgentsProject';
import { useCorrectUserNameInUrl } from './lib/useCorrectUserNameInUrl';
import { useEditApplicationData } from './lib/useEditApplicationData';
import { useEditApplicationEditorBridge } from './lib/useEditApplicationEditorBridge';
import { useEditApplicationForm } from './lib/useEditApplicationForm';
import { useEditApplicationVersionControls } from './lib/useEditApplicationVersionControls';
import { useEditApplicationVersionFields } from './lib/useEditApplicationVersionFields';
import { useIsVersionNotFound } from './lib/useIsVersionNotFound';
import { useSelectedProjectId } from './lib/useSelectedProjectId';
import { EditApplicationActions } from './ui/EditApplicationActions';
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
 *    ConfigurationTab.jsx`) owns the six `ApplicationConfigurationLayout`
 *    slots (instructions, tools, welcome message, advance settings, editor
 *    notes, information) and still has no port. PARTIALLY CLOSED: the panel
 *    below no longer renders an empty `<Box/>`, and (#307) is no longer
 *    read-only — it renders
 *    `features/agents`' `CreateAgentForm`, the same component the baseline
 *    shares between its create and edit pages, so the agent's real
 *    name/description/instructions are on screen. The remaining slots
 *    (tools, advance settings, editor notes) are still absent.
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
 *  - Nav-blocking-when-dirty (`useNavBlocker`, baseline) is CLOSED (#133).
 *    It used to be dropped here on the grounds that no promoted equivalent
 *    existed; in fact `widgets/app-shell`'s `NavBlockerDialog` had a real,
 *    app-wide TanStack `useBlocker` all along and only lacked a setter
 *    outside the chat process, so a dirty agent edit was silently lost on
 *    any nav-link click. This page now arms it through
 *    `useUnsavedChangesNavBlocker` (see the call site below).
 *  - Saving is CLOSED (#307). This used to disclose that only
 *    `conversation_starters` was persisted, which was true and meant the
 *    page saved nothing a user could type. It now routes every field it
 *    renders — see the save-scope comment on the `useEditApplicationForm`
 *    call below for the two remaining, backend-side gaps (`variables` is a
 *    no-op on UPDATE; `conversation_starters` still has no input mounted).
 *
 * **Read-only (public-viewer) gating, save-failure feedback, and the
 * detail-404 page** (adversarial-review fixes): the baseline's
 * `useViewMode()` hides the Save/Save-New-Version buttons whenever the
 * currently selected project is the public project (`ApplicationTabBar.jsx:65`);
 * this page reproduces that default via the same `isPublicAgentsProject`
 * check `Applications.tsx`/`useApplicationsData.ts` (this unit) already use
 * for the identical "is the current viewing context public" question — no
 * override is threaded through the `viewMode` search param declared on
 * `/agents/$tab` because nothing in this unit's own navigation call sites
 * (`Latest`/`MyLiked`/`Trending`/`PrivateAgentsList`) ever sets it, so
 * reading it here would not change the actual, reachable behaviour. A
 * failed save now surfaces via `useEditApplicationForm`'s `saveError`,
 * rendered as an inline `role="alert"` banner (this app has no toast
 * infrastructure — see that hook's own doc comment). A 404/400 on the
 * application-DETAIL fetch itself now renders the same dedicated
 * not-found `NoResultsMessage` this file already used for an unknown
 * version id, instead of falling through to the normal edit-page shell —
 * old app: `EditApplication.jsx`'s `shouldShowNotFoundPage = (isError &&
 * isNotFoundError(error)) || isVersionNotFound` → `<Page404 />`.
 */
export function EditApplication(): ReactNode {
  const projectId = useSelectedProjectId();
  const params = useParams({ strict: false }) as EditApplicationParams;
  const search = useSearch({ strict: false }) as EditApplicationSearch;
  const applicationId = parseApplicationId(params.agentId);
  const requestedVersionId = params.version;

  const { detail, versions, activeVersion, isFetching, isError, isDetailNotFound } = useEditApplicationData(
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

  /*
   * #307 — the version-level fields `CreateAgentForm` renders (instructions,
   * welcome message, variables, step limit) live here rather than in the RHF
   * form: `applicationCreationSchema` does not validate them (same split
   * `CreateApplication.tsx` already makes for the create page). Resolved
   * BEFORE the form hook because the save payload reads them.
   */
  const versionFields = useEditApplicationVersionFields(activeVersion);

  const { form, handleSave, isSaving, saveError, isDirty } = useEditApplicationForm(
    detail,
    activeVersion,
    projectId,
    applicationId,
    versionFields,
  );

  /*
   * #133 — arm the app-wide unsaved-changes guard from this page's own dirty
   * state. `widgets/app-shell`'s `NavBlockerDialog` and its TanStack
   * `useBlocker` are mounted under every page and have always worked; the
   * standalone agent editor simply never raised the flag, so editing an
   * agent and clicking any nav link navigated through and lost the edit.
   * (This replaces the "nav-blocking-when-dirty is dropped" gap this file's
   * header used to disclose.) `formState.isDirty` covers exactly the fields
   * this page routes back into the form — `name`/`description`, per
   * `useEditApplicationEditorBridge`'s `shouldDirty: true`. The hook
   * disarms on unmount; `useEditApplicationForm` clears dirtiness after a
   * successful save so saving is not itself prompted about.
   *
   * #307 — `versionFields.isDirty` is the other half: instructions/welcome
   * message/variables/step limit are held outside the form (see below), so
   * `formState.isDirty` cannot see them and a user who edited only those
   * would have navigated away without a prompt. Same two-part dirty check
   * `CreateApplication.tsx` already builds from its own `extraFields`.
   */
  useUnsavedChangesNavBlocker(isDirty);

  // Old app: `useViewMode.js` — `viewMode` defaults to `ViewMode.Public`
  // whenever the currently selected project equals `PUBLIC_PROJECT_ID`.
  // `ApplicationTabBar.jsx:65` only renders the Save/Save-New-Version
  // buttons when `viewMode !== ViewMode.Public` — every viewer reaching
  // this page through this unit's own public-project tabs (`Latest`/
  // `MyLiked`/`Trending`/the public "Admin" `PrivateAgentsList`, none of
  // which pass a `viewMode` override on navigation) is a read-only viewer
  // of someone else's public agent, not its owner. (Hoisted above the
  // version bar in #134: `AgentVersionControls` gates its own
  // "Save As Version" on the same flag, so it must be resolved first.)
  const isReadOnlyView = isPublicAgentsProject(projectId);

  /*
   * #134 — the version bar. `versionSummaries` above used to be this page's
   * ONLY use of the fetched version list, and it spent them on a 404 check:
   * versions were loaded and never shown. Both halves of the control the
   * baseline puts here (`ApplicationTabBar.jsx:58-68`) were already ported
   * and unreachable — `AgentPipelineVersionSelector` only from a tool card,
   * `SaveNewVersionButton` from nowhere at all.
   *
   * Route/clone/cache decisions all live in the hook — see its own doc
   * comment for why a version switch is a NAVIGATION here rather than the
   * baseline's in-place cache rewrite.
   */
  const versionControls = useEditApplicationVersionControls({
    projectId,
    applicationId,
    tab: params.tab,
    versions,
    activeVersion,
    control: form.control,
    versionFields: versionFields.fields,
    isReadOnly: isReadOnlyView,
    isFetching,
  });

  /*
   * The configuration panel used to be `<Box data-testid=… />` — self-closing
   * and empty — on the grounds that the baseline's `ConfigurationTab` belonged
   * to a sibling sub-unit. The consequence was that opening ANY agent showed a
   * page with no fields on it: J14 created an agent, navigated to it, and found
   * nothing to read back.
   *
   * `CreateAgentForm` is a public export of `features/agents` and is what
   * `pages/agents/CreateApplication.tsx` already renders; the baseline shares
   * that same component between its create and edit pages.
   *
   * SAVE SCOPE (#307, closed): the panel is now writable as well as
   * readable. `useEditApplicationForm` sends the application-level
   * `name`/`description` through `editApplication` (PUT
   * /elitea_core/application/…, routed since #117) and the version-level
   * `instructions`/`welcome_message`/`variables`/`meta.step_limit`/
   * `conversation_starters` through `updateApplicationVersion` — the two
   * real endpoints `features/agents`' `useSaveVersion` already issues. This
   * comment used to disclose that only `conversation_starters` was sent,
   * which was true and meant the page saved nothing a user could type.
   *
   * TWO GAPS REMAIN, both backend-side and neither closable from here:
   *  - `variables` is sent but silently discarded on UPDATE — the Go
   *    `UpdateVersion` handler (applications/handler.go:807-836) reads
   *    `name`/`instructions`/`welcome_message`/`agent_type`/`llm_settings`/
   *    `conversation_starters`/`meta`/`pipeline_settings` and has no
   *    `variables` branch at all; only `CreateVersion` persists them.
   *  - `conversation_starters` has no input mounted (see the
   *    `conversationStartersSlot` note on `CreateAgentForm`) — the editor
   *    component itself has no port in this app, so the value round-trips
   *    from the server but cannot be changed.
   */
  const editor = useEditApplicationEditorBridge(form, versionFields);

  if (isDetailNotFound) {
    return (
      <Box sx={pageSx}>
        <NoResultsMessage
          title={t('pages.agents.editApplication.agentNotFound.title', 'Agent not found')}
          description={t('pages.agents.editApplication.agentNotFound.description', 'This agent no longer exists.')}
        />
      </Box>
    );
  }

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
          {versionControls.showVersionControls && (
            <AgentVersionControls
              applicationId={versionControls.applicationIdText}
              projectId={projectId}
              versions={versionControls.versionOptions}
              activeVersionId={versionControls.activeVersionId}
              onSelectVersion={versionControls.handleSelectVersion}
              versionBody={versionControls.versionBody}
              canSaveNewVersion={versionControls.canSaveNewVersion}
              versionDelete={versionControls.versionDelete}
              onNewVersionSaved={versionControls.handleNewVersionSaved}
            />
          )}
          {/*
           * #307 — the entity-level actions (export, delete). Both were
           * ported, tested, and imported by nothing at all; see
           * `./ui/EditApplicationActions.tsx` for the baseline placement and
           * for why they are writer-only.
           */}
          {!isFetching && !isReadOnlyView && (
            <>
              <EditApplicationActions
                applicationId={params.agentId}
                detail={detail}
                activeVersion={activeVersion}
                tab={params.tab}
              />
              <EditApplicationSaveBar
                onSave={handleSave}
                canSave={form.formState.isValid && !isSaving}
                isSaving={isSaving}
              />
            </>
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
          {saveError !== undefined && (
            <Typography
              role="alert"
              variant="bodyMedium"
            >
              {t('pages.agents.editApplication.saveError', 'Failed to save your changes.')}
            </Typography>
          )}
          <Box data-testid="edit-application-configuration-tab-panel">
            <CreateAgentForm
              values={editor.values}
              onFieldChange={editor.onFieldChange}
              disabled={isReadOnlyView || isFetching}
            />
          </Box>
        </Box>
      </Box>
    </FormProvider>
  );
}
