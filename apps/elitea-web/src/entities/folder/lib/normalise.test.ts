import { describe, expect, it } from 'vitest';

import { conversationMatchId, flattenGroupedConversations } from './normalise';
import type { GroupedFoldersResponse } from '../model/types';

describe('conversationMatchId', () => {
  it('composes id and isPlayback exactly like the old app', () => {
    expect(conversationMatchId({ id: 'abc', isPlayback: true })).toBe('abc_isPlayback_true');
  });

  it('renders "undefined" for a missing isPlayback, matching the old app string concatenation', () => {
    expect(conversationMatchId({ id: 'abc' })).toBe('abc_isPlayback_undefined');
  });
});

describe('flattenGroupedConversations', () => {
  it('flattens pinned, date_groups, and folders into one array', () => {
    const response: GroupedFoldersResponse = {
      pinned: { conversations: [{ id: 'p1' }] },
      dateGroups: [
        { name: 'today', conversations: [{ id: 't1' }] },
        { name: 'older', conversations: [{ id: 'o1' }, { id: 'o2' }] },
      ],
      folders: [{ id: 'f1', name: 'Folder', conversations: [{ id: 'fc1' }] }],
      totalFolders: 1,
    };
    expect(flattenGroupedConversations(response).map((c) => c.id)).toEqual(['p1', 't1', 'o1', 'o2', 'fc1']);
  });

  it('returns an empty array when everything is empty', () => {
    const response: GroupedFoldersResponse = {
      pinned: { conversations: [] },
      dateGroups: [],
      folders: [],
      totalFolders: 0,
    };
    expect(flattenGroupedConversations(response)).toEqual([]);
  });
});
