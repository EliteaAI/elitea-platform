import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate } from '@tanstack/react-router';

import { DeleteApplicationButton, ExportApplicationButton } from '@/features/agents';
import type { ApplicationDetail, ApplicationVersionDetail } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { disarmUnsavedChangesNavBlocker } from '@/widgets/app-shell';

/**
 * The agent editor's entity-level actions — export and delete — mounted next
 * to the save bar, where the baseline puts them
 * (`apps/elitea-ui/src/[fsd]/entities/application-tab-bar/ui/
 * ApplicationControls.jsx`, which renders `ExportApplicationButton` and
 * `DeleteApplicationButton` side by side for the agent's own page).
 *
 * #307 — both components were fully ported and fully tested with ZERO
 * importers; this is the mount point they were missing. Split into its own
 * file rather than inlined into `EditApplication.tsx` because that page is
 * at its §3.5 400-line/complexity-12 budget (the same reason every other
 * hook of that page lives in `./lib/`).
 *
 * Deliberately rendered only for a writer (`EditApplication` gates on the
 * same `isReadOnlyView` it already uses for the save bar): the baseline's
 * `ApplicationControls` sits inside the block `ApplicationTabBar.jsx:65`
 * hides for `ViewMode.Public`, and offering a public viewer a Delete button
 * that the backend will refuse is worse than not offering it.
 */
export interface EditApplicationActionsProps {
  /** The agent's id, as the route carries it. `undefined` while the route param is unparseable — the actions then render disabled rather than acting on a wrong id. */
  readonly applicationId: string | undefined;
  readonly detail: ApplicationDetail | undefined;
  /** Currently-open version — export follows exactly this one version (`ExportApplicationButton`'s own contract). */
  readonly activeVersion: ApplicationVersionDetail | undefined;
  /** The list tab to return to once the agent is gone. */
  readonly tab: string | undefined;
}

/*
 * The `?.`/`??` unwrapping below deliberately lives HERE rather than at the
 * `<EditApplicationActions .../>` call site: `EditApplication` sits at the
 * §3.5 cyclomatic-complexity budget (12) exactly, and three optional-chain
 * props passed inline took it to 15.
 */
export function EditApplicationActions({
  applicationId,
  detail,
  activeVersion,
  tab,
}: EditApplicationActionsProps): ReactNode {
  const name = detail?.name;
  const currentVersionId = activeVersion?.id;
  const listTab = tab ?? 'latest';
  const navigate = useNavigate();
  const [error, setError] = useState<string | undefined>(undefined);

  const handleDeleted = useCallback(() => {
    // The agent no longer exists, so the edits still in the form are moot —
    // without this, the nav guard `EditApplication` arms from its own dirty
    // state would prompt "you have unsaved changes" on the way out of a
    // page whose subject was just deleted (#133's own disarm contract, same
    // call `CreateApplication`'s Cancel makes).
    disarmUnsavedChangesNavBlocker();
    void navigate({ to: '/agents/$tab', params: { tab: listTab } });
  }, [navigate, listTab]);

  const handleDeleteError = useCallback(
    () => setError(t('pages.agents.editApplication.deleteError', 'Failed to delete this agent.')),
    [],
  );
  const handleExportError = useCallback(
    () => setError(t('pages.agents.editApplication.exportError', 'Failed to export this agent.')),
    [],
  );

  return (
    <Box sx={wrapperSx}>
      {error !== undefined && (
        <Typography
          role="alert"
          variant="bodySmall"
        >
          {error}
        </Typography>
      )}
      <ExportApplicationButton
        applicationId={applicationId}
        name={name}
        currentVersionId={currentVersionId}
        onError={handleExportError}
      />
      <DeleteApplicationButton
        applicationId={applicationId ?? ''}
        name={name}
        disabled={applicationId === undefined}
        onDeleted={handleDeleted}
        onError={handleDeleteError}
      />
    </Box>
  );
}

const wrapperSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: '0.25rem' };
