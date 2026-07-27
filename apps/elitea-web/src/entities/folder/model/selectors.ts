import { conversationMatchId } from '../lib/normalise';
import type { DateGroup, Folder } from './types';

/**
 * apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/constants/
 * conversationList.constants.js:7,9.
 */
export const DATE_GROUP_ORDER = ['today', 'this_week', 'older'] as const;
export const DEFAULT_EXPANDED_GROUP = 'today';

/**
 * apps/elitea-ui/src/[fsd]/pages/Chat/components/GroupedConversations.jsx:
 * 24-27 — `dateGroups.filter(group => group.conversations?.length > 0)`.
 */
export function visibleDateGroups(groups: readonly DateGroup[]): DateGroup[] {
  return groups.filter((group) => group.conversations.length > 0);
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/conversation-list/lib/hooks/
 * useDateGroupExpansion.hooks.js:64-99 `initializeExpansion`, its pure
 * kernel: which group should be expanded, given the current groups and
 * (optionally) the id of the currently-selected conversation match
 * (`genConversationId`-shaped — see `lib/normalise.ts`'s
 * `conversationMatchId`). Preference order: the group containing the
 * selected conversation; else `"today"` if it exists; else the first group
 * present in `DATE_GROUP_ORDER`; else `undefined`.
 */
export function resolveInitialExpandedGroup(
  groups: readonly DateGroup[],
  selectedConversationMatchId: string | undefined,
): string | undefined {
  if (groups.length === 0) return undefined;

  if (selectedConversationMatchId !== undefined) {
    const containing = groups.find((group) =>
      group.conversations.some((conv) => conversationMatchId(conv) === selectedConversationMatchId),
    );
    if (containing !== undefined) return containing.name;
  }

  if (groups.some((group) => group.name === DEFAULT_EXPANDED_GROUP)) return DEFAULT_EXPANDED_GROUP;

  for (const name of DATE_GROUP_ORDER) {
    if (groups.some((group) => group.name === name)) return name;
  }
  return undefined;
}

export function isPinnedFolder(folder: Folder): boolean {
  return folder.isPinned === true;
}

/** Alphabetical name sort, case-insensitive. */
export function sortFoldersByName(folders: readonly Folder[]): Folder[] {
  return [...folders].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}
