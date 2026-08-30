import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { folderApi } from '@/entities/folder';
import { PERMISSIONS } from '@/shared/lib/permissions';

import { conversationListErrorMessage } from '../errorMessage';
import { useHasPermission } from '../useHasPermission';
import type { FolderListItem } from './conversationListState.types';

export interface UseCreateFolderParams {
  readonly projectId: string | undefined;
  /**
   * NO LONGER READ — kept only because the composition root
   * (`processes/chat/model/useConversationSidebar.ts`) still passes it, and an
   * object literal with an undeclared property is a type error.
   *
   * It was the base of the post-create list write, and that write happens AFTER
   * `await folderApi.create`: a render-time snapshot there discarded every
   * folder that landed during the POST (`useQueryFoldersList` populates the
   * same container asynchronously, and its first page routinely arrives inside
   * that window), because the write REPLACED the list rather than amending it.
   * The write is a functional updater now, so it reads the list React holds at
   * commit time — the strongest form of the "read live" fix, and the one
   * `processes/chat/model/useConversationSidebar.ts`'s ref doc block names as
   * already-safe-by-construction. Delete this field once the call site drops it.
   */
  readonly folders?: readonly FolderListItem[];
  readonly setActiveFolder: (folder: FolderListItem | undefined) => void;
  readonly setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>;
  readonly toastError: (message: string) => void;
  /** Baseline: `setActiveParticipant()` clears the active chat participant on cancel — optional since not every caller needs it. */
  readonly setActiveParticipant?: () => void;
  /**
   * Baseline: `useResetCreateFlag().resetCreateFlag()` clears the URL's
   * create-mode search param via `react-router-dom`'s `useSearchParams`.
   * This app uses `@tanstack/react-router`, and `features/` may not import
   * `pages/`/`app/`-level router wiring (R-L1) — injected as a caller's
   * seam instead, the same "caller's seam for a cross-layer concern"
   * convention `toastError` itself already uses (both were ALREADY injected
   * props in the baseline, not new deviations this port introduces).
   */
  readonly onResetCreateFlag?: () => void;
}

export interface UseCreateFolderResult {
  readonly onCreateFolder: (newFolder: FolderListItem, onCreatedCallback?: (created?: FolderListItem) => void) => Promise<void>;
  readonly onCancelCreateFolder: (folder?: FolderListItem) => void;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/
 * hooks/useCreateFolder.hooks.js` (unit C2).
 *
 * **Disclosed scope cut:** GA analytics
 * (`trackEvent(GA_EVENT_NAMES.CONVERSATION_FOLDER_CREATED, ...)`, baseline
 * `:36-38`) is dropped — this app has no analytics module anywhere yet,
 * the same one-line gap already disclosed by `entities/conversation/lib/
 * hooks/useUploadAttachments.ts`, `features/agents/model/
 * useAgentCreation.ts`, and `features/toolkits/model/useToolkitCreation.ts`
 * for the identical situation.
 *
 * **Disclosed placeholder change:** on failure the baseline resets
 * `activeFolder` to `dummyConversation` (`common/constants.js:1023` — a
 * CONVERSATION-shaped placeholder, not `dummyFolder`; almost certainly a
 * baseline copy-paste artefact, not intentional). This port resets to
 * `undefined` instead of inventing a fake cross-domain placeholder object —
 * `activeFolder: FolderListItem | undefined` already models "no active
 * folder" as `undefined` throughout this slice.
 */
export function useCreateFolder(params: UseCreateFolderParams): UseCreateFolderResult {
  const { projectId, setActiveFolder, setFolders, toastError, setActiveParticipant, onResetCreateFlag } = params;
  const hasCreatePermission = useHasPermission(projectId, PERMISSIONS.chat.folders.create);
  const [createError, setCreateError] = useState<unknown>(undefined);
  const queryClient = useQueryClient();

  const onCreateFolder = useCallback(
    async (newFolder: FolderListItem, onCreatedCallback?: (created?: FolderListItem) => void): Promise<void> => {
      setActiveFolder(newFolder);

      if (projectId === undefined || !hasCreatePermission) {
        // Baseline's mutation-trigger `{skip: ...}` is a no-op for RTK Query
        // mutations (`skip` only applies to queries) — the real POST always
        // fired, and a genuine 403 surfaced through the mutation's own error
        // state -> `toastError`. This early return skips the network call
        // entirely, so the toast has to fire explicitly here instead, same
        // fix `useReorderFolders.ts`'s own permission-gate already applies.
        // Found missing by adversarial verify.
        if (projectId !== undefined) toastError('You do not have permission to create folders');
        setActiveFolder(undefined);
        setFolders((prev) => prev.filter((item) => !item.isNew));
        onCreatedCallback?.();
        return;
      }

      try {
        const created = await folderApi.create({ projectId, name: newFolder.name });
        setCreateError(undefined);
        const createdItem: FolderListItem = { ...created, conversations: [] };
        setActiveFolder(createdItem);
        // Amends the list React holds NOW rather than replacing it with a
        // render-time copy — see `folders` in `UseCreateFolderParams`.
        setFolders((prev) => [createdItem, ...prev.filter((item) => !item.isNew)]);
        // `folderApi.create` is the plain fetcher, not `folderApi.useCreate`
        // (no consumer anywhere uses the mutation-hook forms — see that
        // file's own doc comment) — invalidate here so a background
        // `useQueryFoldersList` (its `totalFolderCount` in particular) isn't
        // left stale for up to the 30s default `staleTime`. Found missing
        // by adversarial verify.
        void queryClient.invalidateQueries({ queryKey: ['folder', 'list'] });
        onCreatedCallback?.(createdItem);
      } catch (caught) {
        setCreateError(caught);
        setActiveFolder(undefined);
        setFolders((prev) => prev.filter((item) => !item.isNew));
        onCreatedCallback?.();
      }
    },
    [projectId, hasCreatePermission, setActiveFolder, setFolders, toastError, queryClient],
  );

  const onCancelCreateFolder = useCallback(
    (folder?: FolderListItem): void => {
      setActiveFolder(undefined);
      if (folder?.id) setFolders((prev) => prev.filter((item) => item.id !== folder.id));
      else setFolders((prev) => prev.filter((item) => !item.isNew));
      setActiveParticipant?.();
      onResetCreateFlag?.();
    },
    [setActiveFolder, setFolders, setActiveParticipant, onResetCreateFlag],
  );

  useEffect(() => {
    if (createError !== undefined) toastError(conversationListErrorMessage(createError));
  }, [createError, toastError]);

  return { onCreateFolder, onCancelCreateFolder };
}
