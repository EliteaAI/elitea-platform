import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { folderApi } from '@/entities/folder';

import { conversationListErrorMessage } from '../errorMessage';
import type { FolderListItem } from './conversationListState.types';

export interface UseDeleteFolderParams {
  readonly projectId: string | undefined;
  readonly setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>;
  readonly toastError: (message: string) => void;
}

export interface UseDeleteFolderResult {
  readonly onDeleteFolder: (folder: FolderListItem) => Promise<void>;
}

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useDeleteFolder.js` (unit C2).
 * The baseline names its parameter `conversation`, but every field it reads
 * (`.id`, `.isPlayback`) and its `areTheSameFolders` comparison make clear
 * it is always called with a FOLDER — renamed to `folder` here, disclosed
 * rather than silently "fixed".
 *
 * **isPlayback-skip business rule, preserved even though unreachable
 * today:** `entities/folder`'s `Folder` type has no `isPlayback` field at
 * all (no real folder producer — `folderApi.list`/`.create` — ever sets
 * one; see `FolderListItem`'s own doc comment). The baseline's guard
 * (`useDeleteFolder.js:19`, "playback/virtual folders never hit the
 * backend") is kept byte-faithful regardless, since a future caller may
 * still construct a synthetic `FolderListItem` with `isPlayback: true` the
 * same way the baseline's callers evidently could.
 */
export function useDeleteFolder(params: UseDeleteFolderParams): UseDeleteFolderResult {
  const { projectId, setFolders, toastError } = params;
  const [error, setError] = useState<unknown>(undefined);
  const queryClient = useQueryClient();

  const onDeleteFolder = useCallback(
    async (folder: FolderListItem): Promise<void> => {
      let succeeded = true;

      if (!folder.isPlayback) {
        if (projectId === undefined) return;
        try {
          await folderApi.remove({ projectId, id: folder.id });
          setError(undefined);
          // `folderApi.remove` is the plain fetcher — see
          // `useCreateFolder.hooks.ts`'s doc comment for why this
          // invalidation has to happen at this call site rather than
          // relying on `folderApi.useRemove`'s own (unused) wiring. Found
          // missing by adversarial verify.
          void queryClient.invalidateQueries({ queryKey: ['folder', 'list'] });
        } catch (caught) {
          setError(caught);
          succeeded = false;
        }
      }

      if (succeeded) {
        setFolders((prev) => prev.filter((item) => item.id !== folder.id));
      }
    },
    [projectId, setFolders, queryClient],
  );

  useEffect(() => {
    if (error !== undefined) toastError(conversationListErrorMessage(error));
  }, [error, toastError]);

  return { onDeleteFolder };
}
