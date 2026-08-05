/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * This unit (C2) adds exactly 1 export (`folderApi`) to the 13 already here
 * — 14/20, 6 slots of headroom left for future units. Per the established
 * `entities/conversation/index.ts` precedent (`conversationApi`/
 * `contextManagementApi`), the 7 REST endpoints in `./api/foldersApi.ts`
 * are bundled into ONE curated object rather than 12+ individual top-level
 * exports (hooks + plain fetchers). The narrower param types
 * (`FoldersListParams`, `FolderConversationsParams`, etc.) are deliberately
 * NOT re-exported here, same trade-off `entities/conversation/index.ts`
 * discloses — import them directly from `./api/foldersApi` if ever needed.
 */
import {
  dateGroupConversations,
  deleteFolder,
  folderConversations,
  folderCreate,
  folderPinUpdate,
  foldersList,
  folderUpdate,
  useDeleteFolderMutation,
  useFolderCreateMutation,
  useFolderPinUpdateMutation,
  useFoldersListQuery,
  useFolderUpdateMutation,
} from './api/foldersApi';

export type { DateGroup, Folder, FolderConversationRef, GroupedFoldersResponse } from './model/types';
export { DEFAULT_FOLDER_NAME } from './model/types';
export {
  DATE_GROUP_ORDER,
  DEFAULT_EXPANDED_GROUP,
  isPinnedFolder,
  resolveInitialExpandedGroup,
  sortFoldersByName,
  visibleDateGroups,
} from './model/selectors';
export { conversationMatchId, flattenGroupedConversations } from './lib/normalise';

/** Folder CRUD + grouped-list/pagination REST layer (`./api/foldersApi.ts`) — TanStack hooks (`use*`) and their underlying plain-async fetchers, bundled per the `entities/conversation` precedent. */
export const folderApi = {
  useCreate: useFolderCreateMutation,
  useList: useFoldersListQuery,
  useUpdate: useFolderUpdateMutation,
  useRemove: useDeleteFolderMutation,
  usePinUpdate: useFolderPinUpdateMutation,
  create: folderCreate,
  list: foldersList,
  conversationsByFolder: folderConversations,
  conversationsByDateGroup: dateGroupConversations,
  update: folderUpdate,
  remove: deleteFolder,
  updatePin: folderPinUpdate,
} as const;
