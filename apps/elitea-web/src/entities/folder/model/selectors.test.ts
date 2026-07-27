import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPANDED_GROUP, isPinnedFolder, resolveInitialExpandedGroup, sortFoldersByName, visibleDateGroups } from './selectors';
import type { DateGroup, Folder, FolderConversationRef } from './types';

const ref = (id: string, isPlayback = false): FolderConversationRef => ({ id, isPlayback });

describe('visibleDateGroups', () => {
  it('drops groups with no conversations', () => {
    const groups: DateGroup[] = [
      { name: 'today', conversations: [ref('1')] },
      { name: 'older', conversations: [] },
    ];
    expect(visibleDateGroups(groups).map((g) => g.name)).toEqual(['today']);
  });

  it('returns an empty array when every group is empty', () => {
    expect(visibleDateGroups([{ name: 'today', conversations: [] }])).toEqual([]);
  });
});

describe('resolveInitialExpandedGroup', () => {
  const groups: DateGroup[] = [
    { name: 'this_week', conversations: [ref('a')] },
    { name: 'older', conversations: [ref('b')] },
  ];

  it('returns undefined for an empty group list', () => {
    expect(resolveInitialExpandedGroup([], undefined)).toBeUndefined();
  });

  it('prefers the group containing the selected conversation', () => {
    const matchId = `${'b'}_isPlayback_false`;
    expect(resolveInitialExpandedGroup(groups, matchId)).toBe('older');
  });

  it('falls back to "today" when it exists and no selection matches', () => {
    const withToday: DateGroup[] = [...groups, { name: DEFAULT_EXPANDED_GROUP, conversations: [] }];
    expect(resolveInitialExpandedGroup(withToday, undefined)).toBe(DEFAULT_EXPANDED_GROUP);
  });

  it('falls back to the first DATE_GROUP_ORDER entry present when "today" is absent', () => {
    expect(resolveInitialExpandedGroup(groups, undefined)).toBe('this_week');
  });

  it('returns undefined when nothing matches and no known group name is present', () => {
    const unknown: DateGroup[] = [{ name: 'archived', conversations: [ref('a')] }];
    expect(resolveInitialExpandedGroup(unknown, undefined)).toBeUndefined();
  });
});

describe('isPinnedFolder', () => {
  const folder = (isPinned?: boolean): Folder => ({ id: '1', name: 'f', conversations: [], ...(isPinned !== undefined ? { isPinned } : {}) });

  it('is true only when isPinned is exactly true', () => {
    expect(isPinnedFolder(folder(true))).toBe(true);
    expect(isPinnedFolder(folder(false))).toBe(false);
    expect(isPinnedFolder(folder())).toBe(false);
  });
});

describe('sortFoldersByName', () => {
  it('sorts case-insensitively', () => {
    const folders: Folder[] = [
      { id: '1', name: 'zeta', conversations: [] },
      { id: '2', name: 'Alpha', conversations: [] },
    ];
    expect(sortFoldersByName(folders).map((f) => f.id)).toEqual(['2', '1']);
  });
});
