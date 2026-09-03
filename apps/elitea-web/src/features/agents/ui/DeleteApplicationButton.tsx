import { type ReactNode, useCallback, useState } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/Delete';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useQueryClient } from '@tanstack/react-query';

import { getDeleteApplicationQueryOptions } from '@/shared/api/generated/applications/applications';
import { t } from '@/shared/i18n';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { useSelectedProjectId } from '../api/useSelectedProjectId';

/** @public */
export interface DeleteApplicationButtonProps {
  applicationId: string;
  name: string | undefined;
  disabled?: boolean;
  /** Fired after a successful delete — the caller decides where to navigate (old app: `navigate(-1)`, `DeleteApplicationButton.jsx:29`). */
  onDeleted?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Components/
 * Applications/DeleteApplicationButton.jsx`.
 *
 * DISCLOSED DEVIATIONS:
 *  - No ambient form context — `name` is an explicit prop instead of
 *    `useFormikContext().values.name` (this app has no Formik dependency;
 *    see `../model/types.ts`'s module doc comment for the established
 *    convention every sibling `features/agents/ui/*` component follows).
 *  - `useDeleteApplicationMutation` (old app's RTK Query slice) is replaced
 *    by the real generated `getDeleteApplicationQueryOptions` +
 *    `queryClient.query`, the same "every generated endpoint is
 *    `useQuery`-shaped, imperative trigger = `query`" convention
 *    `entities/application-form/model/mutations.ts` already established
 *    (`DELETE /elitea_core/application/prompt_lib/{projectId}/
 *    {applicationId}`).
 *  - `useIsFromPipelineDetail()` (route-matching, dual agent/pipeline
 *    label) is dropped; this port hardcodes "agent" copy — this sub-unit's
 *    scope is the agents domain only (see `entities/application-form`'s own
 *    "`entities/application-form` may NOT import `entities/application`"
 *    doc comment for the sibling precedent of domain-specific ports of a
 *    baseline-shared component). The pipelines domain's own sub-unit gets
 *    its own analogous copy for pipeline copy/semantics.
 *  - `useToast()` is replaced with `onError` (no toast system exists
 *    anywhere in this app yet — same gap `useMcpAuthModal.ts`'s
 *    `projectId`-as-explicit-option precedent documents for infra not owned
 *    by this layer).
 *  - `applicationId` is an explicit prop, not `useParams().agentId` — same
 *    "caller already has route context" reasoning `StatusFilterSelect`'s
 *    `isPublicProject` prop documents.
 *  - `useCheckPermission`/`validatePermission` (baseline's
 *    `DeleteEntityButton.jsx:37`) has no port anywhere in this app yet — no
 *    permission-check primitive exists under `shared/`/`entities/`. Always
 *    renders (baseline's own default is `validatePermission = false`, i.e.
 *    the common case already skips this check).
 *  - `useDeleteConfirmationDisabled` (a "skip the confirm dialog" user
 *    preference) has no port; this always confirms via `DeleteEntityModal`
 *    first, same as `shouldRequestInputName`'s default-off failure mode
 *    (skip is a convenience feature, not a correctness requirement).
 */
export function DeleteApplicationButton({
  applicationId,
  name,
  disabled = false,
  onDeleted,
  onError,
}: DeleteApplicationButtonProps): ReactNode {
  const projectId = useSelectedProjectId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);

  const confirmDelete = useCallback(async () => {
    if (projectId === undefined) return;
    setIsDeleting(true);
    try {
      const options = getDeleteApplicationQueryOptions(projectId, Number(applicationId));
      await queryClient.query(options);
      setOpen(false);
      onDeleted?.();
    } catch (error) {
      onError?.(error);
    } finally {
      setIsDeleting(false);
    }
  }, [projectId, applicationId, queryClient, onDeleted, onError]);

  return (
    <>
      <Tooltip title={t('agents.deleteApplicationButton.title', 'Delete agent')}>
        <span>
          <IconButton
            aria-label={t('agents.deleteApplicationButton.ariaLabel', 'delete entity')}
            color="secondary"
            onClick={openModal}
            disabled={isDeleting || disabled}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <DeleteEntityModal
        open={open}
        onClose={closeModal}
        onConfirm={() => {
          void confirmDelete();
        }}
        shouldRequestInputName
        confirming={isDeleting}
        {...(name !== undefined ? { name } : {})}
      />
    </>
  );
}
