/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
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
