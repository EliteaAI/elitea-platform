import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { conversationApi, hasPlaybackConversation } from '@/entities/conversation';
import type { Conversation } from '@/entities/conversation';
import { DEFAULT_FOLDER_NAME, folderApi } from '@/entities/folder';

import { conversationListErrorMessage } from '../errorMessage';
import { sortConversations } from '../helpers/conversationList.helpers';
import type { FolderListItem, NewFolderDraft } from './conversationListState.types';

/**
 * Baseline: `useMoveToFolderConversation.hooks.js:113-165`'s
 * `updateConversationWithTargetFolder` stamps a scratch `targetFolderId`
 * onto a conversation while a "move to new folder" is pending user
 * confirmation — never a wire field, hook-local only (same "transient
 * hook-local wiring" class as `NewFolderDraft`'s own two extra fields).
 */
export interface ConversationWithTargetFolder extends Conversation {
  readonly targetFolderId?: string | null;
}

/**
 * Baseline's RTK-Query trigger promises resolve to a `{data}` / `{error}`
 * envelope this hook's own callers pattern-match on. That envelope doesn't
 * exist once the network call is a plain `await`able async function
 * (TanStack-idiomatic: reject on failure) — replaced with this explicit
 * discriminated result instead of inventing a fake `{data,error}` shape.
 * Only BUSINESS-RULE failures (playback guard, hasPlaybackConversations
 * guard) resolve as `{success: false}`; a genuine network failure is
 * caught internally (see module doc's error-effect note) and ALSO resolves
 * `{success: false}` rather than rejecting — this matches the baseline's
 * own non-throwing RTK-trigger-promise behaviour byte-for-byte (a caller
 * like `useDragAndDrop.ts`'s `try {await onMoveToFolderConversation(...)}
 * catch {}` never actually observes a network failure here in the
 * baseline either, since the RTK Query trigger resolves rather than
 * rejects — preserved rather than "fixed" into a throw, since fixing it
 * would silently change `useDragAndDrop`'s own `successCount` accounting).
 */
interface MoveConversationResult {
  readonly success: boolean;
  readonly conversation?: Conversation;
  readonly error?: string;
}

export interface UseMoveToFolderConversationParams {
  readonly projectId: string | undefined;
  readonly setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>;
  readonly setActiveFolder: (folder: FolderListItem | NewFolderDraft | undefined) => void;
  readonly setConversations: Dispatch<SetStateAction<readonly ConversationWithTargetFolder[]>>;
  readonly toastError: (message: string) => void;
  readonly toastSuccess?: (message: string) => void;
  /** Read-only lookups for the `hasPlaybackConversations` guard — the ungrouped conversation pool and the folder list, NOT the setters above (baseline: `conversations = [], folders = []`). */
  readonly conversations?: readonly Conversation[];
  readonly folders?: readonly FolderListItem[];
}

export interface UseMoveToFolderConversationResult {
  readonly onMoveToFolderConversation: (conversation: ConversationWithTargetFolder, targetFolder: FolderListItem | null) => Promise<MoveConversationResult>;
  readonly onMoveToNewFolderConversation: (conversation: ConversationWithTargetFolder) => Promise<MoveConversationResult | undefined>;
  readonly moveTargetConversationToNewFolder: (folder: NewFolderDraft) => Promise<MoveConversationResult | undefined>;
  readonly cancelMovingTargetConversationToNewFolder: (folder: NewFolderDraft) => void;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/
 * hooks/useMoveToFolderConversation.hooks.js` (unit C2).
 *
 * **Disclosed placeholder change (same class as `useCreateFolder.hooks.ts`'s
 * own):** `moveTargetConversationToNewFolder`'s failure branch resets
 * `activeFolder` to `undefined` instead of the baseline's `dummyConversation`
 * placeholder (a conversation-shaped object assigned to a folder-typed
 * slot — the same baseline copy-paste artefact already disclosed there).
 */
export function useMoveToFolderConversation(params: UseMoveToFolderConversationParams): UseMoveToFolderConversationResult {
  const { projectId, setFolders, setActiveFolder, setConversations, toastError, toastSuccess, conversations = [], folders = [] } = params;

  const [editError, setEditError] = useState<unknown>(undefined);
  const [createError, setCreateError] = useState<unknown>(undefined);

  const hasPlaybackConversations = useCallback(
    (originalConversationId: string): boolean =>
      hasPlaybackConversation(conversations, originalConversationId) || folders.some((folder) => hasPlaybackConversation(folder.conversations, originalConversationId)),
    [conversations, folders],
  );

  const moveConversationToFolder = useCallback(
    (conversation: ConversationWithTargetFolder, targetFolder: FolderListItem | null): void => {
      const targetFolderId = targetFolder?.id;
      const isMovingToFolder = targetFolderId !== undefined;

      if (isMovingToFolder) {
        if (conversation.folderId === undefined) {
          setConversations((prev) => sortConversations(prev.filter((item) => item.id !== conversation.id)));
        }
        setFolders((prevFolders) =>
          prevFolders.map((folder) => {
            if (folder.id === targetFolderId) {
              return {
                ...folder,
                conversations: sortConversations([{ ...conversation, folderId: targetFolderId, updatedAt: new Date().toISOString() }, ...folder.conversations]),
              };
            }
            if (folder.id === conversation.folderId) {
              return { ...folder, conversations: sortConversations(folder.conversations.filter((item) => item.id !== conversation.id)) };
            }
            return folder;
          }),
        );
      } else {
        setFolders((prevFolders) =>
          prevFolders.map((folder) =>
            folder.id === conversation.folderId
              ? { ...folder, conversations: sortConversations(folder.conversations.filter((item) => item.id !== conversation.id)) }
              : folder,
          ),
        );
        // `exactOptionalPropertyTypes` forbids assigning `folderId: undefined` directly onto `Conversation` (an
        // optional property must be ABSENT, not present-with-undefined) — destructure it out instead.
        const { folderId: _droppedFolderId, ...conversationWithoutFolder } = conversation;
        setConversations((prev) => sortConversations([{ ...conversationWithoutFolder, updatedAt: new Date().toISOString() }, ...prev]));
      }
    },
    [setConversations, setFolders],
  );

  const updateConversationWithTargetFolder = useCallback(
    (conversation: ConversationWithTargetFolder, targetFolder: FolderListItem | NewFolderDraft | null): void => {
      const targetFolderId = targetFolder?.id ?? null;

      if (conversation.folderId === undefined) {
        setConversations((prev) => sortConversations(prev.map((item) => (item.id === conversation.id ? { ...item, targetFolderId } : item))));
      } else {
        setFolders((prevFolders) =>
          prevFolders.map((folder) => ({
            ...folder,
            conversations: sortConversations(folder.conversations.map((item) => (item.id === conversation.id ? { ...item, targetFolderId } : item))),
          })),
        );
      }
    },
    [setConversations, setFolders],
  );

  const onMoveToFolderConversation = useCallback(
    async (conversation: ConversationWithTargetFolder, targetFolder: FolderListItem | null): Promise<MoveConversationResult> => {
      if (conversation.isPlayback === true) {
        return { success: false, error: 'Cannot move playback conversations' };
      }

      if (hasPlaybackConversations(conversation.id)) {
        toastError('Cannot move this conversation while playback conversations exist. Please delete all playback conversations first.');
        return { success: false, error: 'Cannot move conversation with active playback conversations' };
      }

      const targetFolderId = targetFolder?.id ?? null;
      const currentFolderId = conversation.folderId ?? null;
      if (String(currentFolderId) === String(targetFolderId)) return { success: true, conversation };

      if (projectId === undefined) return { success: false, error: 'No active project' };

      try {
        await conversationApi.edit({ projectId, id: conversation.id, folder_id: targetFolderId });
      } catch (caught) {
        setEditError(caught);
        return { success: false, error: 'Failed to move conversation' };
      }

      setEditError(undefined);
      moveConversationToFolder(conversation, targetFolder);

      if (toastSuccess !== undefined) {
        const message = targetFolder !== null ? `Chat moved to "${targetFolder.name}" folder successfully` : 'Chat moved to ungrouped area successfully';
        toastSuccess(message);
      }

      return { success: true, conversation };
    },
    [projectId, hasPlaybackConversations, toastError, toastSuccess, moveConversationToFolder],
  );

  const onMoveToNewFolderConversation = useCallback(
    async (conversation: ConversationWithTargetFolder): Promise<MoveConversationResult | undefined> => {
      if (conversation.isPlayback === true) {
        return { success: false, error: 'Cannot move playback conversations' };
      }

      if (hasPlaybackConversations(conversation.id)) {
        toastError('Cannot move this conversation while playback conversations exist. Please delete all playback conversations first.');
        return { success: false, error: 'Cannot move conversation with active playback conversations' };
      }

      // Baseline's own comment (`useMoveToFolderConversation.hooks.js:216-217`):
      // "Fake async delay to simulate real BE-related updates to prevent
      // multiple events due to double-clicking." Ported as-is per the C2
      // brief's explicit instruction, not replaced with an in-flight guard.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const newFolderTempId = `${conversation.id}_to_new_folder`;
      const newFolder: NewFolderDraft = {
        id: newFolderTempId,
        name: DEFAULT_FOLDER_NAME,
        conversations: [],
        isNew: true,
        targetConversationId: conversation.id,
        targetConversation: conversation,
      };

      updateConversationWithTargetFolder(conversation, newFolder);

      setFolders((prevFolders) => {
        const folderExists = prevFolders.some((folder) => folder.id === newFolderTempId);
        if (folderExists) return prevFolders;
        return [newFolder, ...prevFolders];
      });

      setActiveFolder({ ...newFolder });
      return undefined;
    },
    [hasPlaybackConversations, toastError, updateConversationWithTargetFolder, setFolders, setActiveFolder],
  );

  const moveTargetConversationToNewFolder = useCallback(
    async (folder: NewFolderDraft): Promise<MoveConversationResult | undefined> => {
      const conversation = folder.targetConversation;
      setActiveFolder(folder);

      if (projectId === undefined) {
        setActiveFolder(undefined);
        setFolders((prev) => prev.filter((item) => !item.isNew));
        return undefined;
      }

      try {
        const created = await folderApi.create({ projectId, name: folder.name });
        setCreateError(undefined);
        const newCreatedFolder: FolderListItem = { ...created, conversations: [] };
        setActiveFolder(newCreatedFolder);
        setFolders((prev) => [newCreatedFolder, ...prev.filter((item) => !item.isNew)]);

        const moveResult = await onMoveToFolderConversation(conversation, newCreatedFolder);
        return moveResult.success ? moveResult : undefined;
      } catch (caught) {
        setCreateError(caught);
        setActiveFolder(undefined);
        setFolders((prev) => prev.filter((item) => !item.isNew));
        return undefined;
      }
    },
    [projectId, setActiveFolder, setFolders, onMoveToFolderConversation],
  );

  const cancelMovingTargetConversationToNewFolder = useCallback(
    (folder: NewFolderDraft): void => {
      updateConversationWithTargetFolder(folder.targetConversation, null);
    },
    [updateConversationWithTargetFolder],
  );

  useEffect(() => {
    if (editError !== undefined) toastError(conversationListErrorMessage(editError));
  }, [editError, toastError]);

  useEffect(() => {
    if (createError !== undefined) toastError(conversationListErrorMessage(createError));
  }, [createError, toastError]);

  return { onMoveToFolderConversation, onMoveToNewFolderConversation, moveTargetConversationToNewFolder, cancelMovingTargetConversationToNewFolder };
}
