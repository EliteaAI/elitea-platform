/**
 * Folder domain type — groups conversations in the chat sidebar. No OpenAPI
 * schema exists for this resource; shape derived from old-app evidence only:
 *
 * - apps/elitea-ui/src/[fsd]/features/chat/conversation-list/api/
 *   conversationList.api.js:22-137 (folderCreate/foldersList/folderUpdate/
 *   deleteFolder/folderPinUpdate — PATCH body `{ is_pinned }`).
 * - apps/elitea-ui/src/common/constants.js:99 — `DefaultFolderName = 'New folder'`.
 * - apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/hooks/
 *   useQueryFoldersList.hooks.js:53-166 — the grouped-list envelope shape
 *   `{ pinned: { conversations }, date_groups: [{ name, conversations }],
 *   folders: [{ id, conversations }], selected_conversation_id, total_folders }`.
 *
 * `ConversationRef` is declared inline rather than importing entities/
 * conversation, per the dependency-cruiser `no-sideways-entities` rule.
 */

export const DEFAULT_FOLDER_NAME = 'New folder';

export interface FolderConversationRef {
  readonly id: string;
  readonly updatedAt?: string;
  readonly createdAt?: string;
  /** Needed to compute `genConversationId` parity — see `lib/normalise.ts`. */
  readonly isPlayback?: boolean;
}

export interface Folder {
  readonly id: string;
  readonly name: string;
  readonly conversations: readonly FolderConversationRef[];
  readonly total?: number;
  readonly offset?: number;
  readonly isPinned?: boolean;
  /**
   * Client-only: not-yet-persisted folder, synthetic id, not a wire field.
   * apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/hooks/
   * useMoveToFolderConversation.hooks.js:229-238 builds exactly this shape
   * (`{id, name, conversations, isNew: true, targetConversationId,
   * targetConversation}`) for the drag-to-"new folder" flow;
   * `targetConversationId`/`targetConversation` are not modeled here as
   * they are transient hook-local wiring, not persisted folder state.
   */
  readonly isNew?: boolean;
}

/** One `date_groups[]` bucket from the grouped folders-list envelope. */
export interface DateGroup {
  readonly name: string;
  readonly conversations: readonly FolderConversationRef[];
}

/** The full `?grouped=true` response envelope — see the module doc citation. */
export interface GroupedFoldersResponse {
  readonly pinned: { readonly conversations: readonly FolderConversationRef[] };
  readonly dateGroups: readonly DateGroup[];
  readonly folders: readonly Folder[];
  readonly selectedConversationId?: string;
  readonly totalFolders: number;
}
