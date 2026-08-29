/**
 * The state + hook wiring behind `ui/ChatConversationSidebar.tsx`.
 *
 * `features/chat-conversation-list` was built complete — `Conversations`,
 * its folder/date-group/drag-and-drop tree, and nine hooks — and then never
 * mounted: `grep -rn "chat-conversation-list" src` outside the slice returned
 * only doc comments, and no testid on the live `/chat` page matched
 * `/folder/i` (issue #128 residual). Every one of those hooks takes its state
 * containers as parameters rather than owning them, precisely because the
 * composition root was meant to own them. This file is that owner.
 *
 * Split out of the component for the §3.5 `max-lines` budget; the component
 * next door is pure composition.
 *
 * Baseline: `apps/elitea-ui/src/pages/NewChat/NewChat.jsx` owns exactly these
 * containers (`folders`/`dateGroups`/`pinnedConversations`/`conversations`/
 * `activeFolder`) and passes exactly this prop bundle to `<Conversations>`
 * at `NewChat.jsx:1372-1412`.
 */
import { useCallback, useState } from 'react';

import { useNavigate } from '@tanstack/react-router';

import type { Conversation } from '@/entities/conversation';
import { conversationApi } from '@/entities/conversation';
import { DEFAULT_FOLDER_NAME } from '@/entities/folder';
import type { ConversationsDateGroup, ConversationsProps, FolderListItem } from '@/features/chat-conversation-list';
import {
  useCreateFolder,
  useDeleteFolder,
  useEditFolder,
  useMoveToFolderConversation,
  usePinConversation,
  useQueryFoldersList,
  useReorderFolders,
} from '@/features/chat-conversation-list';
import type { SocialAuthorProfile } from '@/shared/api/generated/model';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import { getConfig } from '@/shared/config';
import { useSelectedProject } from '@/widgets/app-shell';

/**
 * The SPA's mount point, for the absolute share link `ConversationItem`
 * copies to the clipboard.
 *
 * Without it, `ConversationItem` fell back to `basename: ''` and Share copied
 * `https://host/{projectId}/chat/{id}?...` — a hard 404 for the recipient in
 * every deployment where `vite_base_uri` is not `/`, because only `/app/**`
 * is served by the SPA. Dev hid it: `import.meta.env.DEV` resolves the
 * basename to `''` there.
 *
 * Resolved locally against `shared/config` rather than imported from
 * `app/providers/basename.ts`: `.dependency-cruiser.cjs`'s
 * `no-upward-from-processes` forbids `processes/` -> `app/`. Four other
 * slices carry the same 3-line copy for the same reason
 * (`features/agents/lib/basename.ts`, `features/notifications/lib/routes.ts`,
 * `features/mcps/lib/oauthFlow.ts`, `routes/$projectId.$.tsx`).
 *
 * The trailing slash is trimmed. `vite_base_uri` is `/app/` and
 * `ConversationItem` already concatenates a leading `/`, so keeping it
 * produces `https://host/app//5/chat/...`, whose doubled slash survives the
 * router's basepath strip.
 */
function chatBasename(): string {
  if (import.meta.env.DEV) return '';
  const result = getConfig();
  return result.status === 'ok' ? result.config.vite_base_uri.replace(/\/$/, '') : '';
}

/** What the component needs beyond the `Conversations` prop bundle itself. */
export interface UseConversationSidebarResult {
  readonly conversationsProps: ConversationsProps;
  /** Transient error text for the local snackbar — this app has no global toast host. */
  readonly errorMessage: string | undefined;
  readonly onDismissError: () => void;
}

/**
 * A locally-unique id for the not-yet-persisted draft folder the "Create
 * folder" button pushes into `folders`. `crypto.randomUUID` is the baseline's
 * `uuidv4()` (`NewChat.jsx:1231`) without the dependency; it is available in
 * every browser this app supports and in jsdom under Node 20+.
 */
function draftFolderId(): string {
  return `draft-${crypto.randomUUID()}`;
}

export function useConversationSidebar(): UseConversationSidebarResult {
  const navigate = useNavigate();
  const { project } = useSelectedProject();
  const projectId = project?.id;

  /*
   * The current user's id, for the row menu's author-only guard on Delete and
   * Edit. `Conversations` accepts `currentUserId` as an optional prop, and
   * this composition root never set it, so the guard compared `undefined`
   * with `undefined` and denied nothing.
   *
   * Resolved the same way `features/chat-conversation-list`'s own
   * `FolderItem` resolves it (`useGetCurrentAuthor`), and reactively, so the
   * menu re-renders when the profile lands. The declared response type is a
   * union whose 401 branch is unreachable here. `eliteaFetch` throws on a
   * non-2xx answer. The cast follows that established precedent.
   */
  const currentAuthor = useGetCurrentAuthor();
  const currentUserId = (currentAuthor.data?.data as SocialAuthorProfile | undefined)?.id;

  // ── The state containers every hook in the slice writes through ─────────
  const [folders, setFolders] = useState<readonly FolderListItem[]>([]);
  const [dateGroups, setDateGroups] = useState<readonly ConversationsDateGroup[]>([]);
  const [pinnedConversations, setPinnedConversations] = useState<readonly Conversation[]>([]);
  const [conversations, setConversations] = useState<readonly Conversation[]>([]);
  const [activeFolder, setActiveFolder] = useState<FolderListItem | undefined>(undefined);
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const toastError = useCallback((message: string) => setErrorMessage(message), []);
  const onDismissError = useCallback(() => setErrorMessage(undefined), []);

  /**
   * The list's own restore-on-load path and a user CLICK are deliberately two
   * different callbacks.
   *
   * `useQueryFoldersList` invokes its `onSelectConversation` for whatever the
   * server reports as `selectedConversationId` as soon as the listing lands
   * (useQueryFoldersList.hooks.ts:180-191). Wiring that to a navigation made
   * every visit to `/chat` immediately redirect to `/chat/:lastConversation`,
   * so "start a new chat" was unreachable: the first message went to an
   * EXISTING conversation and never POSTed a new one — J8/J9/J11 all went red.
   * Restoring the highlight is local state; only a click changes the route.
   */
  const restoreSelectedConversation = useCallback((conversation: Conversation) => {
    setActiveConversation(conversation);
  }, []);

  const onSelectConversation = useCallback(
    (conversation: Conversation) => {
      setActiveConversation(conversation);
      void navigate({ to: '/chat/$conversationId', params: { conversationId: conversation.id } });
    },
    [navigate],
  );

  // ── The slice's own hooks, each given the containers above ──────────────
  const foldersList = useQueryFoldersList({
    projectId,
    toastError,
    setFolders,
    setDateGroups,
    setPinnedConversations,
    onSelectConversation: restoreSelectedConversation,
    ...(searchQuery !== undefined ? { searchQuery } : {}),
  });

  const { onCreateFolder, onCancelCreateFolder } = useCreateFolder({
    projectId,
    folders,
    setActiveFolder,
    setFolders,
    toastError,
  });

  const { onDeleteFolder } = useDeleteFolder({ projectId, setFolders, toastError });

  const { onEditFolder, onPinFolder } = useEditFolder({
    projectId,
    activeFolder,
    setActiveFolder,
    setFolders,
    toastError,
  });

  const moveToFolder = useMoveToFolderConversation({
    projectId,
    setFolders,
    setActiveFolder,
    setConversations,
    toastError,
    conversations,
    folders,
  });

  const { onPinConversation } = usePinConversation({
    projectId,
    activeConversation,
    setActiveConversation,
    setPinnedConversations,
    setDateGroups,
    setFolders,
    toastError,
  });

  const { onReorderFolders, isFolderUpdate } = useReorderFolders({
    projectId,
    folders,
    setFolders,
    toastError,
  });

  /**
   * The one required callback with no hook behind it anywhere in the slice —
   * `Conversations.header.tsx`'s "Create folder" button calls it directly
   * (via `Conversations.tsx:208-212`). Baseline: `NewChat.jsx:1228-1238`,
   * reproduced including its re-entrancy guard: while a draft is already
   * open, a second click is a no-op rather than stacking a second draft.
   *
   * The draft carries `DEFAULT_FOLDER_NAME` ('New folder'), which is what the
   * baseline seeds and what `ConversationNameRegExp` accepts — so the editor
   * opens with a valid, confirmable name the user can accept or replace.
   * `FolderItem.tsx:175` renders it in edit mode off `isNew`.
   */
  const onClickCreateNewFolder = useCallback(() => {
    if (activeFolder?.isNew === true) return;
    const draft: FolderListItem = { id: draftFolderId(), name: DEFAULT_FOLDER_NAME, conversations: [], isNew: true };
    setActiveFolder(draft);
    setFolders((prev) => [draft, ...prev]);
  }, [activeFolder?.isNew]);

  const onCollapsed = useCallback(() => setCollapsed((prev) => !prev), []);

  /**
   * Applies one conversation's updated fields to EVERY container a row can
   * render from. The visible rows come from `dateGroups` and `folders`
   * (`Conversations.body.tsx`), not from `conversations` (count-only) — a
   * patch that touched only the latter two was exactly the silent-no-op
   * defect this fixes. Baseline: `useEditConversation.hooks.js` patches
   * `folders` OR `conversations` by `folder_id`; here every container is
   * mapped unconditionally since a non-matching id is a no-op anyway.
   */
  /**
   * Applies one list transform to EVERY container that holds conversation
   * rows. There is exactly one such traversal on purpose: the bug class this
   * module fixes was a mutation applied to SOME of the containers (the rows
   * render from `dateGroups`/`folders`, not from `conversations`), and two
   * hand-written walks re-open that door — a fifth container added to one
   * and not the other is the same silent no-op again.
   */
  const transformEveryConversationList = useCallback(
    (transform: (items: readonly Conversation[]) => readonly Conversation[]) => {
      setConversations((prev) => [...transform(prev)]);
      setPinnedConversations((prev) => [...transform(prev)]);
      setDateGroups((prev) => prev.map((group) => ({ ...group, conversations: [...transform(group.conversations)] })));
      setFolders((prev) => prev.map((folder) => ({ ...folder, conversations: [...transform(folder.conversations)] })));
    },
    [],
  );

  const patchConversationEverywhere = useCallback(
    (updated: Conversation) => {
      transformEveryConversationList((items) =>
        items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
      setActiveConversation((prev) => (prev !== undefined && prev.id === updated.id ? { ...prev, ...updated } : prev));
    },
    [transformEveryConversationList],
  );

  const deleteConversation = useCallback(
    (conversation: Conversation) => {
      if (projectId === undefined) return;
      void conversationApi
        .remove({ projectId, id: conversation.id })
        .then(() => {
          // The row being deleted renders out of `dateGroups`/`folders`
          // (`Conversations.body.tsx`) — filtering only `conversations` and
          // `pinnedConversations`, as this used to, left the row on screen.
          transformEveryConversationList((items) => items.filter((item) => item.id !== conversation.id));
          if (activeConversation?.id === conversation.id) {
            // The route still points at the deleted transcript. The baseline
            // selects the next conversation (`NewChat.jsx:1141-1157`); this
            // navigates to the blank `/chat` instead — simpler, and `/chat`
            // is this app's own "start a new chat" surface.
            setActiveConversation(undefined);
            void navigate({ to: '/chat' });
          }
        })
        .catch(() => toastError('Failed to delete the conversation'));
    },
    [projectId, activeConversation?.id, navigate, toastError, transformEveryConversationList],
  );

  const renameConversation = useCallback(
    (name: string) => {
      if (projectId === undefined || activeConversation === undefined) return;
      void conversationApi
        .edit({ projectId, id: activeConversation.id, name })
        .catch(() => toastError('Failed to rename the conversation'));
    },
    [projectId, activeConversation, toastError],
  );

  const createConversation = useCallback(
    async (conversation: Conversation): Promise<unknown> => {
      if (projectId === undefined) return undefined;
      try {
        // `is_private` is required by the wire contract; the baseline's own
        // create path (`NewChat.jsx`'s `onCreateConversation`) sends the
        // conversation's `is_private`, defaulting to a private conversation.
        return await conversationApi.create({ projectId, name: conversation.name, is_private: conversation.isPrivate ?? true });
      } catch {
        toastError('Failed to create the conversation');
        return undefined;
      }
    },
    [projectId, toastError],
  );

  /*
   * DISCLOSED GAP — `onPlaybackConversation` has no route in this app yet
   * (the baseline's playback surface, `features/chat-messages`'
   * `PlaybackChatBox`, is not mounted by any route either), so it selects
   * the conversation and stops there rather than pretending to start a
   * playback.
   */

  /**
   * `ConversationItem` calls `onEdit` with the ALREADY-updated conversation
   * for both the rename editor's save (`ConversationItem.tsx`'s `onSave`)
   * and the menu's "Make public" (`handleMakePublic`) — so this must
   * persist, not merely select. It used to be
   * `setActiveConversation(conversation)` only, which made both gestures
   * silent no-ops. Baseline: `useEditConversation.hooks.js`'s
   * `onEditConversation` — same PUT (name + is_private), same skip for a
   * playback conversation, same patch-visible-state-on-success ordering
   * (no optimistic write, so a failed PUT leaves the list truthful).
   */
  const onEditConversation = useCallback(
    (conversation: Conversation) => {
      if (conversation.isPlayback === true) {
        // Baseline skips the network call for a playback conversation but
        // still applies the local patch (`useEditConversation.hooks.js:23`).
        patchConversationEverywhere(conversation);
        return;
      }
      if (projectId === undefined) return;
      void conversationApi
        .edit({ projectId, id: conversation.id, name: conversation.name, is_private: conversation.isPrivate })
        .then(() => patchConversationEverywhere(conversation))
        .catch(() => toastError('Failed to edit the conversation'));
    },
    [projectId, patchConversationEverywhere, toastError],
  );
  const onCancelCreateConversation = useCallback(() => setActiveConversation(undefined), []);

  /*
   * Deliberately NOT memoised. `Conversations` is a plain function component
   * (no `memo`), so a fresh props object costs nothing, and the baseline
   * passes these ~30 values as individual JSX props with no memo either
   * (`NewChat.jsx:1372-1412`). A `useMemo` here would need every one of them
   * in its dependency array — 27 entries, over the §3.5 `hook-deps` budget of
   * 8 — and would be wrong the moment one were forgotten.
   */
  const conversationsProps: ConversationsProps = {
    conversations,
    pinnedConversations,
    dateGroups,
    setDateGroups,
    ungroupedConversationsCount: conversations.length,
    totalConversationsAmount: dateGroups.reduce((sum, group) => sum + (group.total ?? group.conversations.length), 0),
    onSelectConversation,
    ...(activeConversation !== undefined ? { selectedConversationId: activeConversation.id } : {}),
    collapsed,
    onCollapsed,
    onEditConversation,
    onPlaybackConversation: onSelectConversation,
    onDeleteConversation: deleteConversation,
    // `usePinConversation` returns a Promise-valued handler; the prop is
    // `(c, shouldPin) => void`. Wrapped rather than passed directly so the
    // floating promise is explicitly discarded (`typescript/no-misused-
    // promises`) — errors are already surfaced by the hook's own toastError.
    onPinConversation: (conversation, shouldPin) => void onPinConversation(conversation, shouldPin),
    onCreateConversation: createConversation,
    onCancelCreateConversation,
    onChangeActiveConversationName: renameConversation,
    onCreateFolder,
    onCancelCreateFolder,
    folders,
    setFolders,
    onDeleteFolder,
    onEditFolder,
    onPinFolder,
    onMoveToFolderConversation: moveToFolder.onMoveToFolderConversation,
    onMoveToNewFolderConversation: moveToFolder.onMoveToNewFolderConversation,
    moveTargetConversationToNewFolder: moveToFolder.moveTargetConversationToNewFolder,
    cancelMovingTargetConversationToNewFolder: moveToFolder.cancelMovingTargetConversationToNewFolder,
    onClickCreateNewFolder,
    toastError,
    onReorderFolders,
    onSearchQueryChange: setSearchQuery,
    isLoadConversations: foldersList.isLoadFolders,
    isFolderOperationInProgress: isFolderUpdate || foldersList.isLoadFolders || foldersList.isLoadMoreFolders,
    basename: chatBasename(),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(currentUserId !== undefined ? { currentUserId } : {}),
  };

  return { conversationsProps, errorMessage, onDismissError };
}
