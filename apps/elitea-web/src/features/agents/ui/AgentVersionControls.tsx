import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ApplicationVersionDetail, VersionWriteRequest } from '@/shared/api/generated/model';

import { useSetDefaultVersion } from '../model/useSetDefaultVersion';
import type { AgentPipelineVersionOption } from '../lib/types';

import { AgentPipelineVersionSelector } from './AgentPipelineVersionSelector';
import { CompareVersionsButton } from './compare-versions/CompareVersionsButton';
import { DeleteVersionButton } from './DeleteVersionButton';
import { SaveNewVersionButton } from './SaveNewVersionButton';
import { SetDefaultVersionDialog } from './SetDefaultVersionDialog';

/**
 * The agent editor's version bar: the version dropdown plus "Save As
 * Version" — the pair the baseline mounts side by side in
 * `apps/elitea-ui/src/[fsd]/entities/application-tab-bar/ui/
 * ApplicationTabBar.jsx:58-68` (`<ApplicationVersionSelect/>` in the centred
 * block, `<SaveNewVersionButton/>` in the right-hand one, the latter gated on
 * `viewMode !== ViewMode.Public`).
 *
 * WHY THIS FILE EXISTS (#134). Both halves were already ported and both were
 * unreachable from the agent edit page: `AgentPipelineVersionSelector`'s only
 * production importer was `ToolCardBody.tsx` (a TOOL card, not the agent's own
 * page) and `SaveNewVersionButton` had no production importer at all. The page
 * even fetched the version list and spent it solely on a 404 check. This
 * component is the composition root the two were missing — one symbol on
 * `features/agents`' curated public API (§3.3 ≤20) instead of two.
 *
 * Deliberately dumb: every mutation-adjacent decision (which route a version
 * switch navigates to, what the cloned version body contains, cache
 * invalidation after a new version is created) stays with the page, matching
 * `AgentPipelineVersionSelector`'s own "the version-SWITCH mutation is
 * entirely caller-owned" contract.
 *
 * **SET DEFAULT (#147) is the one mutation this component does own, and the
 * reason is that the page has nothing to do with the result.** JRNY-015's
 * middle step ("create a new version -> SET DEFAULT -> delete old") had no
 * UI at all: the route, the handler, the repo write and the generated
 * `setApplicationDefaultVersion` all existed, and nothing in the app called
 * any of them. A page-owned `onDefaultVersionSet` callback would have been
 * one more prop that only ever forwarded to a query invalidation that
 * changes nothing — see the disclosed read gap below — so the whole
 * affordance is mounted here, gated on the same `canSaveNewVersion` flag the
 * other two write controls use.
 *
 * **The current default IS readable now — it is fetched, and only
 * remembered as an override.** `applications.meta.default_version_id` is
 * written by `SetDefaultVersion` (`repos/applications.go:650-682`) and, since
 * the read half landed, reported by `GET /application/...` in two places:
 * `meta.default_version_id` on the application and `is_default` on each
 * `versions[]` entry (`applications/handler.go`'s `Get`/`getVersions`). The
 * options this component is handed carry that flag through
 * (`AgentPipelineVersionOption.is_default`), so the default shows on FIRST
 * render and survives a reload.
 *
 * The remembered id below is now an OVERRIDE for the window between a
 * successful PATCH and the next detail fetch, not the only source. It wins
 * while set, because in that window the server flag this component was
 * rendered with is known-stale by exactly the write it just made.
 *
 * The one thing still not readable is a default recorded for a version the
 * list does not contain; the list is the whole version set, so that is a
 * database inconsistency rather than a gap.
 */
export interface AgentVersionControlsProps {
  readonly applicationId: string;
  readonly projectId: string | undefined;
  readonly versions: readonly AgentPipelineVersionOption[];
  readonly activeVersionId: number | undefined;
  readonly onSelectVersion: (version: AgentPipelineVersionOption) => void;
  /**
   * The current version's fields, cloned onto the new one. `name` is supplied
   * by the dialog inside `SaveNewVersionButton`, which is why it is excluded
   * here (see `useSaveNewVersion`'s doc comment: `name` is the one field the
   * Go handler genuinely requires on this operation).
   */
  readonly versionBody: Omit<VersionWriteRequest, 'name'>;
  /** `false` for a read-only (public-project) viewer, mirroring `ApplicationTabBar.jsx:65` — the selector stays, only the write affordance goes. */
  readonly canSaveNewVersion: boolean;
  /**
   * Disables "Save As Version" ALONE, leaving the selector, "Set as default"
   * and "Delete version" alive.
   *
   * Deliberately separate from `canSaveNewVersion`, which is the
   * writer-vs-public-viewer gate and also governs those other two controls.
   * The pipelines editor needs to withhold this one button while the live
   * flow graph is one the runtime would refuse — that write persists the
   * graph, so it must obey the same veto the Save button does — and it must
   * NOT thereby take away the user's ability to delete a version or pin a
   * default, neither of which touches the canvas.
   */
  readonly saveNewVersionDisabled?: boolean | undefined;
  readonly onNewVersionSaved: (created: ApplicationVersionDetail) => void;
  readonly onNewVersionError?: ((message: string) => void) | undefined;
  /**
   * #307 — version delete. `useDeleteVersion` was exported from this slice's
   * public API for "a not-yet-built version-delete dialog" and then had no
   * caller anywhere; `VersionReplacementModal`, its in-use branch, had none
   * either. Both hang off `DeleteVersionButton`, composed here so the
   * version bar stays the single mount point for everything version-scoped.
   * Optional: a caller that cannot supply `onVersionDeleted` (nowhere to
   * navigate afterwards) gets no delete affordance rather than a dead one.
   */
  readonly versionDelete?:
    | {
        readonly applicationVersionId: number | undefined;
        readonly versionName: string;
        readonly onVersionDeleted: () => void;
        readonly onVersionDeleteError?: ((message: string) => void) | undefined;
      }
    | undefined;
}

const wrapperSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.75rem' };

/**
 * Which version the menu marks as the default.
 *
 * `justSet` — the id of a PATCH this component has already seen succeed — wins
 * over the flag on the options, because in the window before the detail is
 * re-fetched those options are stale by exactly that write. With no such write,
 * the server's own answer decides.
 *
 * `find` rather than `filter`: exactly one version may carry the flag (the Go
 * handler derives every row's from the single `applications.meta.
 * default_version_id`), so a second one would be a database inconsistency, not
 * a case to render. `=== true` so an option list that omits the field reads as
 * "this list cannot say" rather than as a truthiness accident.
 *
 * Module-level, not inline: `AgentVersionControls` sits on oxlint's
 * `complexity` budget (§3.5, ≤12) and the predicate alone put it over.
 */
function resolveDefaultVersionId(
  versions: readonly AgentPipelineVersionOption[],
  justSet: number | undefined,
): number | undefined {
  if (justSet !== undefined) return justSet;
  return versions.find((version) => version.is_default === true)?.id;
}

export function AgentVersionControls({
  applicationId,
  projectId,
  versions,
  activeVersionId,
  onSelectVersion,
  versionBody,
  canSaveNewVersion,
  saveNewVersionDisabled = false,
  onNewVersionSaved,
  onNewVersionError,
  versionDelete,
}: AgentVersionControlsProps): ReactNode {
  /* #147 — the version awaiting confirmation, and the default this component
     has itself just set (see the module doc: an override over the server's
     own flag, for the window before the detail is re-fetched). */
  const [pendingDefault, setPendingDefault] = useState<AgentPipelineVersionOption | undefined>(undefined);
  const [justSetDefaultId, setJustSetDefaultId] = useState<number | undefined>(undefined);

  const defaultVersionId = resolveDefaultVersionId(versions, justSetDefaultId);

  // The hook's ids are non-optional; the item is only offered once `projectId`
  // resolves, so the placeholder below is never the one a request is made with
  // — the same guard `DeleteVersionButton` states for its own ids.
  const { doSetDefaultVersion, isSettingDefaultVersion, errorMessage, resetError } = useSetDefaultVersion({
    projectId: projectId ?? '',
    applicationId: Number(applicationId),
  });

  const canSetDefault = canSaveNewVersion && projectId !== undefined;

  const requestSetDefault = useCallback(
    (version: AgentPipelineVersionOption) => {
      resetError();
      setPendingDefault(version);
    },
    [resetError],
  );

  const closeSetDefault = useCallback(() => setPendingDefault(undefined), []);

  const confirmSetDefault = useCallback(async (): Promise<void> => {
    if (pendingDefault === undefined) return;
    const ok = await doSetDefaultVersion(pendingDefault.id);
    // Left open on failure: the default is unchanged, and closing the dialog
    // would read as "done". `errorMessage` carries the server's own refusal.
    if (!ok) return;
    setJustSetDefaultId(pendingDefault.id);
    setPendingDefault(undefined);
  }, [doSetDefaultVersion, pendingDefault]);

  return (
    <Box sx={wrapperSx}>
      {/* #compare-versions — offered from the version bar, the same place the
          baseline offers it (`ApplicationControls.jsx:172`'s dropdown item,
          gated there on `versions.length >= 2`). Read-only, so unlike the
          baseline's item it is NOT additionally gated on the update
          permission. */}
      <CompareVersionsButton
        projectId={projectId}
        applicationId={Number(applicationId)}
        versions={versions}
        activeVersionId={activeVersionId}
      />
      <AgentPipelineVersionSelector
        applicationVersionId={activeVersionId}
        versions={versions}
        onSelectVersion={onSelectVersion}
        defaultVersionId={defaultVersionId}
        {...(canSetDefault ? { onSetDefaultVersion: requestSetDefault } : {})}
      />
      <SetDefaultVersionDialog
        open={pendingDefault !== undefined}
        versionName={pendingDefault?.name ?? ''}
        confirming={isSettingDefaultVersion}
        errorMessage={errorMessage}
        onClose={closeSetDefault}
        onConfirm={() => {
          void confirmSetDefault();
        }}
      />
      {versionDelete !== undefined && canSaveNewVersion && (
        <DeleteVersionButton
          projectId={projectId}
          applicationId={Number(applicationId)}
          versionId={versionDelete.applicationVersionId}
          versionName={versionDelete.versionName}
          onDeleted={versionDelete.onVersionDeleted}
          {...(versionDelete.onVersionDeleteError === undefined ? {} : { onError: versionDelete.onVersionDeleteError })}
        />
      )}
      {canSaveNewVersion && (
        <SaveNewVersionButton
          applicationId={applicationId}
          projectId={projectId}
          existingVersionNames={versions.map((version) => version.name)}
          version={versionBody}
          disabled={saveNewVersionDisabled}
          onSuccess={onNewVersionSaved}
          {...(onNewVersionError === undefined ? {} : { onError: onNewVersionError })}
        />
      )}
    </Box>
  );
}
