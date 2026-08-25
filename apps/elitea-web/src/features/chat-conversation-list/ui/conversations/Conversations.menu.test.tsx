import type { Theme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';
import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

import { buildMoveToFoldersMenuItems, type BuildMoveToFoldersMenuItemsParams } from './Conversations.menu';
import type { ConversationsFolder } from './Conversations.types';

const theme: Theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

const conversation: Conversation = { id: 'c1', name: 'c1', isPrivate: true };

function buildItems(overrides: Partial<BuildMoveToFoldersMenuItemsParams> = {}): ReturnType<typeof buildMoveToFoldersMenuItems> {
  const folders: readonly ConversationsFolder[] = [{ id: 'f1', name: 'Folder A', conversations: [] }];
  return buildMoveToFoldersMenuItems({
    conversation,
    conversations: [conversation],
    folders,
    hasFolderCreatePermission: true,
    hasFolderUpdatePermission: true,
    currentUserId: undefined,
    theme,
    onMoveToFolderConversation: vi.fn(() => Promise.resolve(undefined)),
    onMoveToNewFolderConversation: vi.fn(() => Promise.resolve(undefined)),
    ...overrides,
  });
}

function folderItem(items: ReturnType<typeof buildMoveToFoldersMenuItems>, key: string): (typeof items)[number] {
  const found = items.find((item) => item.key === key);
  if (found === undefined) throw new Error(`no menu item ${key}`);
  return found;
}

describe('buildMoveToFoldersMenuItems', () => {
  // DEFECT: `ConversationsFolder.ownerId` has no producer, so the target is
  // always `undefined`. A strict inequality against a real signed-in user id
  // disabled every folder in the "Move to" submenu.
  it('keeps a folder target enabled when the folder carries no owner id', () => {
    const items = buildItems({ currentUserId: 'user-9' });
    expect(folderItem(items, 'folder-f1').disabled).toBe(false);
  });

  it('disables a folder target owned by another user', () => {
    const items = buildItems({ currentUserId: 'user-9', folders: [{ id: 'f1', name: 'Folder A', conversations: [], ownerId: 'user-2' }] });
    expect(folderItem(items, 'folder-f1').disabled).toBe(true);
  });

  it('enables a folder target owned by the current user', () => {
    const items = buildItems({ currentUserId: 'user-9', folders: [{ id: 'f1', name: 'Folder A', conversations: [], ownerId: 'user-9' }] });
    expect(folderItem(items, 'folder-f1').disabled).toBe(false);
  });

  it('disables every folder target without the folder update permission', () => {
    const items = buildItems({ currentUserId: 'user-9', hasFolderUpdatePermission: false });
    expect(folderItem(items, 'folder-f1').disabled).toBe(true);
  });
});
