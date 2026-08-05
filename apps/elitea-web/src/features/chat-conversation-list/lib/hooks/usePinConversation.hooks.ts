import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { useMutation } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';

import type { Conversation } from '@/entities/conversation';
import { pinEntity, unpinEntity } from '@/shared/api/generated/social/social';

import type { DateGroupListItem, FolderListItem } from './conversationListState.types';

function removeFromDateGroups(setDateGroups: Dispatch<SetStateAction<readonly DateGroupListItem[]>>, conversationId: string): void {
  setDateGroups((prev) =>
    prev.map((group) => {
      const found = group.conversations.some((c) => c.id === conversationId);
      if (!found) return group;
      return { ...group, conversations: group.conversations.filter((c) => c.id !== conversationId), total: Math.max((group.total ?? 0) - 1, 0) };
    }),
  );
}

function removeFromFolders(setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>, conversationId: string): void {
  setFolders((prev) =>
    prev.map((folder) => {
      const found = folder.conversations.some((c) => c.id === conversationId);
      if (!found) return folder;
      return { ...folder, conversations: folder.conversations.filter((c) => c.id !== conversationId), total: Math.max((folder.total ?? 0) - 1, 0) };
    }),
  );
}

function restoreToDateGroups(setDateGroups: Dispatch<SetStateAction<readonly DateGroupListItem[]>>, conversation: Conversation): void {
  setDateGroups((prev) => {
    const targetGroup = prev.find((g) => g.name === 'today') ?? prev[0];
    if (targetGroup === undefined) return prev;
    return prev.map((group) =>
      group.name !== targetGroup.name ? group : { ...group, conversations: [conversation, ...group.conversations], total: (group.total ?? 0) + 1 },
    );
  });
}

function restoreToFolders(setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>, conversation: Conversation): void {
  setFolders((prev) =>
    prev.map((folder) =>
      folder.id !== conversation.folderId ? folder : { ...folder, conversations: [conversation, ...folder.conversations], total: (folder.total ?? 0) + 1 },
    ),
  );
}

/**
 * Applies ONE direction of the pin/unpin local-state transition —
 * `shouldPin: true` pins (prepend to `pinnedConversations`, remove from its
 * date-group/folder), `shouldPin: false` unpins (the exact inverse). Used
 * for BOTH the optimistic apply (`shouldPin`) and the on-failure rollback
 * (`!shouldPin`) — extracted purely to keep `onPinConversation` under the
 * §3.5 complexity budget, replacing what were 2 near-identical if/else
 * blocks in the baseline (one per direction) with 1 parametrised call site
 * used twice.
 */
function applyPinState(
  shouldPin: boolean,
  conversation: Conversation,
  unpinnedConversation: Conversation,
  setPinnedConversations: Dispatch<SetStateAction<readonly Conversation[]>>,
  setDateGroups: Dispatch<SetStateAction<readonly DateGroupListItem[]>>,
  setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>,
): void {
  if (shouldPin) {
    setPinnedConversations((prev) => [{ ...conversation, isPinned: true }, ...prev]);
    if (conversation.folderId !== undefined) removeFromFolders(setFolders, conversation.id);
    else removeFromDateGroups(setDateGroups, conversation.id);
  } else {
    setPinnedConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    if (conversation.folderId !== undefined) restoreToFolders(setFolders, unpinnedConversation);
    else restoreToDateGroups(setDateGroups, unpinnedConversation);
  }
}

/** Keeps `activeConversation`'s own `isPinned` flag in sync with the pinned conversation, when it IS the active one — extracted purely to keep `onPinConversation` under the §3.5 complexity budget. */
function syncActiveConversationPin(
  activeConversation: Conversation | undefined,
  conversationId: string,
  isPinned: boolean,
  setActiveConversation: Dispatch<SetStateAction<Conversation | undefined>>,
): void {
  if (activeConversation?.id !== conversationId) return;
  setActiveConversation((prev) => (prev === undefined ? prev : { ...prev, isPinned }));
}

export interface UsePinConversationParams {
  readonly projectId: string | undefined;
  readonly activeConversation: Conversation | undefined;
  readonly setActiveConversation: Dispatch<SetStateAction<Conversation | undefined>>;
  readonly setPinnedConversations: Dispatch<SetStateAction<readonly Conversation[]>>;
  readonly setDateGroups: Dispatch<SetStateAction<readonly DateGroupListItem[]>>;
  readonly setFolders: Dispatch<SetStateAction<readonly FolderListItem[]>>;
  readonly toastError?: (message: string) => void;
}

export interface UsePinConversationResult {
  readonly onPinConversation: (conversation: Conversation, shouldPin: boolean) => Promise<void>;
}

interface TogglePinInput {
  readonly entityId: string;
  readonly shouldPin: boolean;
}

/**
 * The generic cross-entity pin mechanism (`entityType: 'conversation'`
 * hardcoded), per the C2 brief's context section — `shared/api/generated/
 * social/social.ts`'s raw `pinEntity`/`unpinEntity` async fetchers (NOT the
 * generated `usePinEntity`/`useUnpinEntity` hooks, which are generated
 * query-shaped and don't fit an on-click toggle action), wrapped in a
 * locally-owned `useMutation` instead. `entityId` is coerced `Number(...)`
 * — the generated signature's `entityId: number` param, against this
 * codebase's `Conversation.id: string` domain field; same class of
 * cross-type-boundary coercion the brief's own context section flags for
 * author/owner ids.
 */
function useTogglePinConversation(projectId: string | undefined): UseMutationResult<unknown, unknown, TogglePinInput> {
  return useMutation({
    mutationFn: async ({ entityId, shouldPin }: TogglePinInput) => {
      if (projectId === undefined) throw new Error('No active project');
      const numericEntityId = Number(entityId);
      return shouldPin ? pinEntity(projectId, 'conversation', numericEntityId) : unpinEntity(projectId, 'conversation', numericEntityId);
    },
  });
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/
 * hooks/usePinConversation.hooks.js` (unit C2) — full optimistic-update-
 * then-rollback-on-failure: pin/unpin is applied to local state FIRST
 * (`setPinnedConversations`/`removeFrom*`/`restoreTo*`), then the network
 * call fires; on failure, the exact inverse of the optimistic update is
 * replayed to roll back (this is why `removeFromDateGroups`/
 * `removeFromFolders`/`restoreToDateGroups`/`restoreToFolders` are each
 * called from BOTH the optimistic-apply branch and the rollback branch,
 * with the pin/unpin direction flipped).
 *
 * **NOTE(old app pin mechanism, disclosed per the brief):** the baseline's
 * `usePinConversation.hooks.js` calls `useTogglePinItemMutation` from
 * `src/api/social.js` — an OLDER, unrelated pin mechanism, DIFFERENT from
 * the generic `pinEntity`/`unpinEntity` pair this codebase's generated
 * client now exposes (`social.pinEntity`/`social.unpinEntity`,
 * `POST`/`DELETE /social/pin/prompt_lib/{project_id}/{entity_type}/
 * {entity_id}`). This port uses the NEW generated pair, per the brief.
 */
export function usePinConversation(params: UsePinConversationParams): UsePinConversationResult {
  const { projectId, activeConversation, setActiveConversation, setPinnedConversations, setDateGroups, setFolders, toastError } = params;
  const { mutateAsync: togglePin } = useTogglePinConversation(projectId);

  const onPinConversation = useCallback(
    async (conversation: Conversation, shouldPin: boolean): Promise<void> => {
      // `exactOptionalPropertyTypes` forbids `isPinned: undefined` directly (an optional property
      // must be ABSENT, not present-with-undefined) — destructure it out instead of assigning it away.
      const { isPinned: _droppedIsPinned, ...unpinnedConversation }: Conversation = conversation;

      applyPinState(shouldPin, conversation, unpinnedConversation, setPinnedConversations, setDateGroups, setFolders);
      syncActiveConversationPin(activeConversation, conversation.id, shouldPin, setActiveConversation);

      try {
        await togglePin({ entityId: conversation.id, shouldPin });
      } catch {
        applyPinState(!shouldPin, conversation, unpinnedConversation, setPinnedConversations, setDateGroups, setFolders);
        syncActiveConversationPin(activeConversation, conversation.id, !shouldPin, setActiveConversation);
        toastError?.(shouldPin ? 'Failed to pin conversation' : 'Failed to unpin conversation');
      }
    },
    [activeConversation, setActiveConversation, setPinnedConversations, setDateGroups, setFolders, togglePin, toastError],
  );

  return { onPinConversation };
}
