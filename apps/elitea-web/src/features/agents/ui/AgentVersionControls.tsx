import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ApplicationVersionDetail, VersionWriteRequest } from '@/shared/api/generated/model';

import type { AgentPipelineVersionOption } from '../lib/types';

import { AgentPipelineVersionSelector } from './AgentPipelineVersionSelector';
import { SaveNewVersionButton } from './SaveNewVersionButton';

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
}: AgentVersionControlsProps): ReactNode {
  return (
    <Box sx={wrapperSx}>
      <AgentPipelineVersionSelector
        applicationVersionId={activeVersionId}
        versions={versions}
        onSelectVersion={onSelectVersion}
      />
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
