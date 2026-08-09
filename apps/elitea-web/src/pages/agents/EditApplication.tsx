import { useMemo, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useParams, useSearch } from '@tanstack/react-router';
import { FormProvider } from 'react-hook-form';

import { CreateApplicationTabBar } from '@/entities/application-form';
import { CreateAgentForm } from '@/features/agents';
import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { useUnsavedChangesNavBlocker } from '@/widgets/app-shell';

import { applicationDetailDisplayName, toVersionSummaries } from './lib/editApplicationMappers';
import { isPublicAgentsProject } from './lib/isPublicAgentsProject';
import { useCorrectUserNameInUrl } from './lib/useCorrectUserNameInUrl';
import { useEditApplicationData } from './lib/useEditApplicationData';
import { useEditApplicationEditorBridge } from './lib/useEditApplicationEditorBridge';
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
 *    ConfigurationTab.jsx`) owns the six `ApplicationConfigurationLayout`
 *    slots (instructions, tools, welcome message, advance settings, editor
 *    notes, information) and still has no port. PARTIALLY CLOSED: the panel
 *    below no longer renders an empty `<Box/>` — it renders
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
 *  - Only the version-level fields `useSaveApplicationVersion` can actually
 *    carry (`conversation_starters` here, since name/description are
 *    APPLICATION-level fields — `ApplicationUpdateRequest`, a different,
 *    not-wired-in-this-pass endpoint) are saved. See `entities/
 *    application-form/model/mutations.ts`'s own doc comment for the
 *    `tags`/`tools`/`pipeline_settings` gap on this same endpoint.
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

  const { form, handleSave, isSaving, saveError } = useEditApplicationForm(detail, activeVersion, projectId, applicationId);

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
   */
  useUnsavedChangesNavBlocker(form.formState.isDirty);

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
   * SAVE SCOPE, unchanged and disclosed: `useEditApplicationForm` persists
   * version-level fields only (`conversation_starters`). `name`/`description`
   * are APPLICATION-level (`ApplicationUpdateRequest`, PUT
   * /elitea_core/application/… — routed since #117, but not wired into this
   * page's save path). They render populated and editable because showing the
   * agent's real identity is the point of the page; edits to them are NOT yet
   * persisted. Wiring that endpoint is its own change.
   */
  const editor = useEditApplicationEditorBridge(form, activeVersion);

  /*
   * The configuration panel used to be `<Box data-testid=… />` — self-closing
   * and empty — on the grounds that the baseline's `ConfigurationTab` belonged
   * to a sibling sub-unit. The consequence was that opening ANY agent showed a
   * page with no fields on it at all: J14 created an agent, navigated to it,
   * and found nothing to read back.
   *
   * `CreateAgentForm` is a public export of `features/agents` and is what
   * `pages/agents/CreateApplication.tsx` already renders; the baseline shares
   * that same component between its create and edit pages. Bridging it to the
   * form this page already owns is the smallest faithful fill.
   *
   * SAVE SCOPE, unchanged and disclosed: `useEditApplicationForm` persists
   * version-level fields only (`conversation_starters`). `name`/`description`
   * are APPLICATION-level (`ApplicationUpdateRequest`, PUT
   * /elitea_core/application/... — now routed since #117 but not wired into
   * this page's save path). They render populated and editable here because
   * showing the agent's real identity is the point of the page, but edits to
   * them are NOT yet persisted. Wiring that endpoint is its own change.
   */
  // `useWatch`, not `form.watch(...)`. This page's form is fed by `useForm({
  // values })` — the values arrive asynchronously, after the agent detail
  // resolves. `form.watch()` read in the render body did NOT pick that up here:
  // the page re-rendered (the heading showed the agent's name) and
  // `formState.isValid` flipped true (Save became enabled), proving the form
  // held the values, while `watch()` still returned ''. `useWatch` subscribes to
  // the control properly and re-renders on the change.
  // Old app: `useViewMode.js` — `viewMode` defaults to `ViewMode.Public`
  // whenever the currently selected project equals `PUBLIC_PROJECT_ID`.
  // `ApplicationTabBar.jsx:65` only renders the Save/Save-New-Version
  // buttons when `viewMode !== ViewMode.Public` — every viewer reaching
  // this page through this unit's own public-project tabs (`Latest`/
  // `MyLiked`/`Trending`/the public "Admin" `PrivateAgentsList`, none of
  // which pass a `viewMode` override on navigation) is a read-only viewer
  // of someone else's public agent, not its owner.
  const isReadOnlyView = isPublicAgentsProject(projectId);

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
          {!isFetching && !isReadOnlyView && (
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
