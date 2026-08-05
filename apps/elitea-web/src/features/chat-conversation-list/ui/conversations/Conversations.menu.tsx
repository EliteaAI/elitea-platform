// Icon substitution (disclosed) — no ported equivalent in `shared/ui/icons/`
// (verified: `ls src/shared/ui/icons/`), same class of gap
// `ConversationSearchButton.tsx`'s own doc comment already established.
import FolderOffOutlinedIcon from '@mui/icons-material/FolderOffOutlined';
import type { Theme } from '@mui/material/styles';

import { hasPlaybackConversation } from '@/entities/conversation';
import type { Conversation } from '@/entities/conversation';
import { t } from '@/shared/i18n';
import type { ControlsDropdownLeafItem } from '@/shared/ui/ControlsDropdown';
import { NewFolderIcon } from '@/shared/ui/icons/new-folder-icon';

import { menuIconStyle, newFolderIconFill } from './Conversations.styles';
import type { ConversationsFolder } from './Conversations.types';

export interface BuildMoveToFoldersMenuItemsParams {
  readonly conversation: Conversation;
  readonly conversations: readonly Conversation[];
  readonly folders: readonly ConversationsFolder[];
  readonly hasFolderCreatePermission: boolean;
  readonly hasFolderUpdatePermission: boolean;
  readonly currentUserId: string | undefined;
  readonly theme: Theme;
  readonly onMoveToFolderConversation: (conversation: Conversation, targetFolder: ConversationsFolder | null) => Promise<unknown>;
  readonly onMoveToNewFolderConversation: (conversation: Conversation) => Promise<unknown>;
}

/**
 * `getMoveConversationToFoldersMenuItems` (`Conversations.jsx:303-396`),
 * split out of `Conversations.tsx` purely to keep that file under the §3.5
 * `max-lines`/`complexity` budgets — a plain function (not a hook) since it
 * needs no state/effects of its own, called from inside a `useCallback` at
 * the call site instead. `usePreventDoubleClick` (baseline: wraps every
 * `onClick` below) has no port anywhere in this codebase yet and is not
 * reproduced here — disclosed scope cut: `ControlsDropdown`'s menu already
 * unmounts synchronously on click (`handleLeafActivate` calls `handleClose()`
 * right after firing `onClick`), which already rules out the same row being
 * double-clicked before the menu is gone, covering the practical case that
 * hook existed to guard.
 */
export function buildMoveToFoldersMenuItems(params: BuildMoveToFoldersMenuItemsParams): ControlsDropdownLeafItem[] {
  const { conversation, conversations, folders, hasFolderCreatePermission, hasFolderUpdatePermission, currentUserId, theme, onMoveToFolderConversation, onMoveToNewFolderConversation } = params;

  if (conversation.isPlayback === true) return [];

  const hasPlaybacks = hasPlaybackConversation(conversations, conversation.id) || folders.some((folder) => hasPlaybackConversation(folder.conversations, conversation.id));
  if (hasPlaybacks) return [];

  const newFolderItem: ControlsDropdownLeafItem = {
    key: 'create_folder',
    label: t('features.chatConversationList.conversations.menu.createFolder', 'Create folder'),
    icon: (
      <NewFolderIcon
        style={menuIconStyle}
        fill={newFolderIconFill(theme, hasFolderCreatePermission)}
      />
    ),
    disabled: !hasFolderCreatePermission,
    onClick: () => void onMoveToNewFolderConversation(conversation),
  };

  const backToListItem: ControlsDropdownLeafItem = {
    key: 'back_to_the_list',
    label: t('features.chatConversationList.conversations.menu.backToTheList', 'Back to the list'),
    icon: (
      <FolderOffOutlinedIcon
        fontSize="small"
        sx={{ color: newFolderIconFill(theme, hasFolderUpdatePermission) }}
      />
    ),
    disabled: conversation.folderId === undefined || !hasFolderUpdatePermission,
    onClick: () => void onMoveToFolderConversation(conversation, null),
  };

  const folderItems: ControlsDropdownLeafItem[] = folders.map((targetFolder) => ({
    key: `folder-${targetFolder.id}`,
    label: targetFolder.name,
    disabled: targetFolder.ownerId !== currentUserId || !hasFolderUpdatePermission || conversation.folderId === targetFolder.id,
    onClick: () => void onMoveToFolderConversation(conversation, conversation.folderId !== targetFolder.id ? targetFolder : null),
  }));

  return [newFolderItem, backToListItem, ...folderItems];
}
