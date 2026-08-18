import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { useDeleteVersion } from '../model/useDeleteVersion';

/**
 * Delete-this-version, next to the version selector — the affordance whose
 * whole data layer (`useDeleteVersion`) was ported and exported from this
 * slice's public API "for a not-yet-built version-delete dialog" and then
 * had no caller at all (#307 lists version-delete among the components with
 * zero importers).
 *
 * **The baseline's in-use branch is deliberately NOT wired, and the reason
 * is a backend defect, not a porting shortcut.** The baseline runs
 * `doCheckVersionInUse` first and, when the version is referenced by other
 * agents/pipelines, opens `VersionReplacementModal` to repoint those
 * references before deleting. The Go endpoint behind that check
 * (`GET /check_version_in_use/...` -> `eliteacore.ApplicationRelation`,
 * handler.go:1590-1627) answers a DIFFERENT question: it selects
 * `entity_skill_mapping`/`entity_tool_mapping` rows WHERE
 * `entity_version_id = <this version>` — the skills and tools THIS version
 * uses, not the parents that reference it. So (a) `isInUse` is true for
 * essentially every non-trivial version, which would put a
 * "choose a replacement" modal in front of every ordinary delete, and
 * (b) the rows it returns are `{type, id}` only (confirmed in the generated
 * contract, `applicationRelationList.zod.ts`) — they carry no
 * `application_name`/`version_name`, which is exactly what that modal lists.
 * Wiring it would produce a confident-looking dialog full of wrong data.
 * Until the endpoint answers the inverse question, this deletes directly and
 * surfaces whatever the delete endpoint itself refuses (it already blocks
 * published/embedded versions server-side, applications/handler.go:865-895).
 *
 * Caller-owned orchestration, matching `useDeleteVersion`'s own contract:
 * no navigation and no cache invalidation here — success is reported through
 * `onDeleted` and the page decides where to go, exactly as
 * `DeleteApplicationButton` does.
 */
export interface DeleteVersionButtonProps {
  readonly projectId: string | undefined;
  readonly applicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly versionName: string;
  readonly onDeleted: () => void;
  readonly onError?: ((message: string) => void) | undefined;
  readonly disabled?: boolean | undefined;
}

export function DeleteVersionButton({
  projectId,
  applicationId,
  versionId,
  versionName,
  onDeleted,
  onError,
  disabled = false,
}: DeleteVersionButtonProps): ReactNode {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The hook's ids are non-optional; the button stays disabled until they
  // resolve, so the placeholders below are never the ones a request is made
  // with.
  const { doDeleteVersion, isDeletingVersion, errorMessage } = useDeleteVersion({
    projectId: projectId ?? '',
    applicationId: applicationId ?? 0,
    versionId: versionId ?? 0,
  });

  const isReady = projectId !== undefined && applicationId !== undefined && versionId !== undefined;

  const handleConfirm = useCallback(async () => {
    const ok = await doDeleteVersion();
    if (!ok) {
      // Left open on failure: the version is still there, and closing the
      // dialog would read as "deleted". `errorMessage` carries the server's
      // own refusal (e.g. "Unpublish first").
      onError?.(errorMessage ?? t('features.agents.deleteVersion.error', 'Failed to delete this version.'));
      return;
    }
    setConfirmOpen(false);
    onDeleted();
  }, [doDeleteVersion, onDeleted, onError, errorMessage]);

  const openConfirm = useCallback(() => setConfirmOpen(true), []);
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);

  return (
    <>
      <Tooltip title={t('features.agents.deleteVersion.title', 'Delete version')}>
        <span>
          <IconButton
            aria-label={t('features.agents.deleteVersion.ariaLabel', 'delete version')}
            color="secondary"
            data-testid="agent-version-delete"
            disabled={disabled || !isReady || isDeletingVersion}
            onClick={openConfirm}
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <DeleteEntityModal
        open={confirmOpen}
        onClose={closeConfirm}
        onConfirm={() => {
          void handleConfirm();
        }}
        confirming={isDeletingVersion}
        name={versionName}
      />
    </>
  );
}
