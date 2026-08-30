import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ApplicationVersionDetail, VersionWriteRequest } from '@/shared/api/generated/model';

import { useSetDefaultVersion } from '../model/useSetDefaultVersion';
import type { AgentPipelineVersionOption } from '../lib/types';

import { AgentPipelineVersionSelector } from './AgentPipelineVersionSelector';
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
 * **DISCLOSED GAP — the current default is not readable, so it is
 * remembered, not fetched.** `applications.meta.default_version_id` is
 * written by `SetDefaultVersion` (`repos/applications.go:650-682`) and
 * emitted by NO documented response: the `Get` handler builds its map from
 * seven keys and `meta` is not one of them
 * (`applications/handler.go:121-152`), `ApplicationVersionSummary` carries
 * no `is_default`, and the 2-segment `GET /default_version/...` that would
 * answer the question is deliberately absent from the contract
 * (`api/openapi/v2.yaml:7048-7052` — "no API item calls it, do not add
 * unused surface"). So on first render this component does not know which
 * version is the default, which is exactly the state the baseline's own
 * `disableSetAsADefault` already handles ("no default recorded -> treat
 * `base` as it"), and after a successful PATCH it knows because it just set
 * it. Closing this properly is a backend/spec change, not a UI one.
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

export function AgentVersionControls({
  applicationId,
  projectId,
  versions,
  activeVersionId,
  onSelectVersion,
  versionBody,
  canSaveNewVersion,
  onNewVersionSaved,
  onNewVersionError,
  versionDelete,
}: AgentVersionControlsProps): ReactNode {
  /* #147 — the version awaiting confirmation, and the default this component
     has itself set (see the module doc: the server never reports one back). */
  const [pendingDefault, setPendingDefault] = useState<AgentPipelineVersionOption | undefined>(undefined);
  const [defaultVersionId, setDefaultVersionId] = useState<number | undefined>(undefined);

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
    setDefaultVersionId(pendingDefault.id);
    setPendingDefault(undefined);
  }, [doSetDefaultVersion, pendingDefault]);

  return (
    <Box sx={wrapperSx}>
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
          onSuccess={onNewVersionSaved}
          {...(onNewVersionError === undefined ? {} : { onError: onNewVersionError })}
        />
      )}
    </Box>
  );
}
