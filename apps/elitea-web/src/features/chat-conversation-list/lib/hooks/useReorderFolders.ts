import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { folderApi } from '@/entities/folder';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { conversationListErrorMessage } from '../errorMessage';
import { useHasPermission } from '../useHasPermission';
import type { FolderListItem } from './conversationListState.types';

/** `!folder.id` (baseline, a falsy-id guard against `null`/`undefined`/`''`) becomes `folder.id === ''`, since `Folder.id` is always `string` in this codebase's domain model — never `null`/`undefined`. */
function getChangedFolders(newOrder: readonly FolderListItem[], previousOrder: readonly FolderListItem[]): FolderListItem[] {
  const previousMap = new Map(previousOrder.map((folder) => [folder.id, folder]));
  return newOrder.filter((folder) => {
    if (folder.isNew === true || folder.id === '') return false;
    const previous = previousMap.get(folder.id);
    if (previous === undefined) return true;
    const hasNeighborContext = folder.neighbor_above_id != null || folder.neighbor_below_id != null;
    return hasNeighborContext;
  });
}

export interface UseReorderFoldersParams {
  readonly projectId: string | undefined;
  readonly folders: readonly FolderListItem[];
  readonly setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>;
  readonly toastError: (message: string) => void;
  readonly toastSuccess?: (message: string) => void;
}

export interface UseReorderFoldersResult {
  readonly onReorderFolders: (newOrder: readonly FolderListItem[]) => Promise<void>;
  readonly isFolderUpdate: boolean;
}

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useReorderFolders.js` (unit
 * C2). `meta` is dropped from each PUT body for the same reason
 * `useEditFolder.ts`'s own doc comment discloses: this codebase's `Folder`
 * has no `meta` field (pinned state moved to `folderApi.updatePin`).
 *
 * **`folders` stays render-scoped, deliberately (stale-closure audit).** Every
 * other hook in this slice that took a state container as a parameter now reads
 * it live; this one does not, and the difference is what the parameter MEANS
 * here. `previousOrder` is not a question about the present ("which folder is
 * selected?", "does a playback conversation exist?") — it is the baseline the
 * caller's `newOrder` ARGUMENT was computed from, and the rollback is only
 * truthful if the two share a provenance. `useDragAndDrop`'s
 * `handleFolderReordering` derives `newOrder` from its own `folders` and calls
 * this handler in the very next statement, reaching it through a `useLatestRef`
 * so the reference invoked is always the current render's; the snapshot is then
 * read synchronously, before any `await`, and exactly once per drop (no
 * captured-reference loop like `moveDraggedConversationsToTarget`'s). There is
 * no window in which the render-time value and a live read could disagree.
 *
 * **Preserved double-toast quirk (not a bug in this port):** a single
 * folder's PUT failure is toasted TWICE — once with a per-folder message
 * (inside the `Promise.all` map, before re-throwing) and once more with the
 * generic `conversationListErrorMessage` result (in the outer `catch`, after the
 * optimistic order is rolled back) — exactly matching the baseline's own
 * `.catch(err => {toastError(...); throw err;})` + outer `catch` shape.
 */
export function useReorderFolders(params: UseReorderFoldersParams): UseReorderFoldersResult {
  const { projectId, folders, setFolders, toastError, toastSuccess } = params;
  const hasUpdatePermission = useHasPermission(projectId, PERMISSIONS.chat.folders.update);
  const [isFolderUpdate, setIsFolderUpdate] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const queryClient = useQueryClient();

  const onReorderFolders = useCallback(
    async (newOrder: readonly FolderListItem[]): Promise<void> => {
      if (newOrder.length === 0) return;

      if (!hasUpdatePermission) {
        toastError('You do not have permission to reorder folders');
        return;
      }

      const previousOrder = [...folders];
      setFolders(newOrder);

      if (projectId === undefined) {
        setFolders(previousOrder);
        return;
      }

      setIsFolderUpdate(true);
      try {
        const foldersToUpdate = getChangedFolders(newOrder, previousOrder);

        await Promise.all(
          foldersToUpdate.map(async (folder) => {
            try {
              await folderApi.update({
                projectId,
                id: folder.id,
                name: folder.name,
                position: folder.position,
                neighbor_above_id: folder.neighbor_above_id,
                neighbor_below_id: folder.neighbor_below_id,
              });
            } catch (caught) {
              toastError(`Failed to update folder ${folder.id}: ${String(caught)}`);
              throw caught;
            }
          }),
        );

        // `folderApi.update` is the plain fetcher — see
        // `useCreateFolder.hooks.ts`'s doc comment for why this invalidation
        // has to happen at this call site. Found missing by adversarial
        // verify.
        void queryClient.invalidateQueries({ queryKey: ['folder', 'list'] });
        toastSuccess?.('Folders reordered successfully');
      } catch (caught) {
        setFolders(previousOrder);
        setError(caught);
      } finally {
        setIsFolderUpdate(false);
      }
    },
    [hasUpdatePermission, projectId, folders, setFolders, toastError, toastSuccess, queryClient],
  );

  useEffect(() => {
    if (error !== undefined) toastError(conversationListErrorMessage(error) || 'Failed to reorder folders');
  }, [error, toastError]);

  return { onReorderFolders, isFolderUpdate };
}
