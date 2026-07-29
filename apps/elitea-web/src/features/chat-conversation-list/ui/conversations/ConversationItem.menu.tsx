// Icon substitutions (disclosed) — none of these five have a ported
// equivalent in `shared/ui/icons/` (verified: `ls src/shared/ui/icons/`).
// `@mui/icons-material`, single-default-import per file, matches
// `shared/ui/ControlsDropdown.tsx`'s own established substitution
// convention for its missing `DotsMenuIcon`. Sized via the `fontSize="small"`
// PROP, not `sx.fontSize` — R-T11 (`elitea/ad-hoc-font-size`) bans ad-hoc
// `sx` font sizes outright and these MUI icon components have no
// `shared/brand` typography-variant integration to size through instead;
// `fontSize="small"` (20px) is the closest of MUI's 3 named sizes to the
// baseline's `1rem` (16px) — same substitution `ui/folders/FolderItem.tsx`'s
// own `<DeleteOutlineIcon fontSize="small" />` already established for an
// identical baseline `sx={{fontSize:'1rem'}}` icon.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { isPublicProject } from '@/entities/project';
import { t } from '@/shared/i18n';
import type { ControlsDropdownItem, ControlsDropdownLeafItem } from '@/shared/ui/ControlsDropdown';
import { CopyLinkIcon } from '@/shared/ui/icons/copy-link-icon';
import { EditIcon } from '@/shared/ui/icons/edit-icon';
import { OpenEyeIcon } from '@/shared/ui/icons/open-eye-icon';
import { PinIcon } from '@/shared/ui/icons/pin-icon';
import { PlayIcon } from '@/shared/ui/icons/play-icon';

import { menuIconStyle } from './ConversationItem.styles';
import type { ConversationWithOwnerMeta } from './ConversationItem.types';

/** `getConversationType` — `ConversationItem.jsx:101-106`. */
export function getConversationType(conversation: ConversationWithOwnerMeta): 'public' | 'private_with_users' | 'private_without_users' {
  if (!conversation.isPrivate) return 'public';
  return (conversation.usersCount ?? 1) > 1 ? 'private_with_users' : 'private_without_users';
}

/** `mainBodyWidth` — `ConversationItem.jsx:108-127`. */
export function computeMainBodyWidth(params: { readonly isHovering: boolean; readonly isPinned: boolean; readonly isPlayback: boolean; readonly conversationType: ReturnType<typeof getConversationType> }): string {
  const { isHovering, isPinned, isPlayback, conversationType } = params;
  let rightMargin = 0;
  if (isHovering) rightMargin += 32;
  if (isPinned && !isPlayback) rightMargin += 20;
  if (conversationType === 'private_with_users' || conversationType === 'public') rightMargin += 20;
  if (isPlayback) rightMargin += 24;
  return `calc(100% - ${rightMargin}px)`;
}

/** `chat_history[0]?.content` (`ConversationItem.jsx:395`) — narrowed without an unsafe cast, since `Conversation.chatHistory` is `readonly unknown[]`. */
export function firstMessagePreview(chatHistory: readonly unknown[] | undefined): string {
  const first = chatHistory?.[0];
  if (first === null || typeof first !== 'object' || !('content' in first)) return '';
  const content = (first as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

/** `projectId == PUBLIC_PROJECT_ID || projectId == personal_project_id` (`ConversationItem.jsx:238`) — the "Make public" item's visibility guard. Both sides default to "not restricted" when the corresponding id is unknown, rather than treating two unset values as a false match. */
export function isPublicOrPersonalProject(projectId: string | undefined, publicProjectId: string | number | undefined, personalProjectId: string | number | undefined): boolean {
  if (projectId === undefined) return false;
  if (publicProjectId !== undefined && isPublicProject(projectId, publicProjectId)) return true;
  return personalProjectId !== undefined && String(projectId) === String(personalProjectId);
}

/** `projectId == personal_project_id` (`ConversationItem.jsx:249`) — the "Share" item's visibility guard. */
export function isPersonalProject(projectId: string | undefined, personalProjectId: string | number | undefined): boolean {
  return projectId !== undefined && personalProjectId !== undefined && String(projectId) === String(personalProjectId);
}

export interface MenuItemsParams {
  readonly conversation: ConversationWithOwnerMeta;
  readonly isActive: boolean;
  readonly isEditingCanvas: boolean;
  readonly currentUserId: string | undefined;
  readonly moveToFoldersMenuItems: readonly ControlsDropdownLeafItem[];
  readonly canMoveToFolders: boolean;
  readonly isPublicOrPersonal: boolean;
  readonly isPersonal: boolean;
  readonly theme: Theme;
  readonly onDelete: () => void;
  readonly onEdit: () => void;
  readonly onExport?: (() => void) | undefined;
  readonly onMakePublic: () => void;
  readonly onShare: () => void;
  readonly onPlayback: () => void;
  readonly onPin: () => void;
}

/** Playback rows only ever offer Delete/Edit (`ConversationItem.jsx:264-278`). */
export function buildPlaybackMenuItems(params: Pick<MenuItemsParams, 'onDelete' | 'onEdit'>): ControlsDropdownItem[] {
  return [
    {
      key: 'delete',
      label: t('features.chatConversationList.conversationItem.menu.delete', 'Delete'),
      icon: <DeleteOutlineIcon fontSize="small" />,
      confirm: {
        message: t('features.chatConversationList.conversationItem.menu.deletePlaybackConfirm', 'Are you sure to delete playback?'),
        confirmLabel: t('features.chatConversationList.conversationItem.menu.delete', 'Delete'),
        onConfirm: params.onDelete,
      },
    },
    {
      key: 'edit',
      label: t('features.chatConversationList.conversationItem.menu.edit', 'Edit'),
      icon: <EditIcon style={menuIconStyle} />,
      onClick: params.onEdit,
    },
  ];
}

function buildDeleteEditItems(params: MenuItemsParams, deleteEditDisabled: boolean, secondaryFillSx: SxProps<Theme>): ControlsDropdownItem[] {
  return [
    {
      key: 'delete',
      label: t('features.chatConversationList.conversationItem.menu.delete', 'Delete'),
      icon: <DeleteOutlineIcon fontSize="small" />,
      disabled: deleteEditDisabled,
      confirm: {
        message: t('features.chatConversationList.conversationItem.menu.deleteConfirm', "Are you sure to delete conversation? It can't be restored."),
        confirmLabel: t('features.chatConversationList.conversationItem.menu.delete', 'Delete'),
        onConfirm: params.onDelete,
      },
    },
    {
      key: 'edit',
      label: t('features.chatConversationList.conversationItem.menu.edit', 'Edit'),
      icon: (
        <Box sx={secondaryFillSx}>
          <EditIcon style={menuIconStyle} />
        </Box>
      ),
      disabled: deleteEditDisabled,
      onClick: params.onEdit,
    },
  ];
}

function buildMoveAndExportItems(params: MenuItemsParams, isEditingActive: boolean): ControlsDropdownItem[] {
  return [
    {
      key: 'move-to',
      label: t('features.chatConversationList.conversationItem.menu.moveTo', 'Move to'),
      icon: <DriveFileMoveOutlinedIcon fontSize="small" />,
      disabled: params.conversation.isPinned === true || !params.canMoveToFolders || isEditingActive,
      items: [...params.moveToFoldersMenuItems],
    },
    {
      key: 'export',
      label: t('features.chatConversationList.conversationItem.menu.export', 'Export'),
      icon: <FileDownloadOutlinedIcon fontSize="small" />,
      disabled: true,
      // `ControlsDropdownLeafItem.onClick` is optional but NOT `| undefined`-
      // widened (external type) — spread it in conditionally rather than
      // assigning `params.onExport` (itself possibly `undefined`) directly,
      // required by this codebase's `exactOptionalPropertyTypes: true`.
      items: [
        { key: 'export-option-1', label: t('features.chatConversationList.conversationItem.menu.exportOption1', 'Option1'), ...(params.onExport !== undefined ? { onClick: params.onExport } : {}) },
        { key: 'export-option-2', label: t('features.chatConversationList.conversationItem.menu.exportOption2', 'Option2'), ...(params.onExport !== undefined ? { onClick: params.onExport } : {}) },
      ],
    },
  ];
}

/**
 * The full, non-playback menu (`ConversationItem.jsx:166-263`). `alertTitle`/
 * `alarm` (baseline Delete item) have no `ControlsDropdownConfirmConfig`
 * equivalent — `shared/ui/ControlsDropdown.tsx`'s own doc comment already
 * discloses that scope cut ("drops the modal confirmation route... drops
 * multi-column layout"), not re-derived here; `confirm.message` carries the
 * confirmation copy alone. The "Move to" item's baseline `ArrowRightIcon`
 * trailing indicator is also dropped: `ControlsDropdownItem` renders no
 * nested-flyout affordance of its own (`aria-haspopup` only), so there is
 * nowhere to put it without changing that shared component.
 */
export function buildActiveMenuItems(params: MenuItemsParams): ControlsDropdownItem[] {
  const { conversation, isActive, isEditingCanvas, currentUserId, isPublicOrPersonal, isPersonal, theme } = params;
  const isEditingActive = isActive && isEditingCanvas;
  const isNotAuthor = String(currentUserId) !== String(conversation.authorId);
  const deleteEditDisabled = isNotAuthor || isEditingActive;
  const secondaryFillSx: SxProps<Theme> = { svg: { path: { fill: theme.vars.palette.secondary.main } } };

  const items: ControlsDropdownItem[] = [...buildDeleteEditItems(params, deleteEditDisabled, secondaryFillSx), ...buildMoveAndExportItems(params, isEditingActive)];

  if (conversation.isPrivate && !isPublicOrPersonal) {
    items.push({
      key: 'make-public',
      label: t('features.chatConversationList.conversationItem.menu.makePublic', 'Make public'),
      icon: <OpenEyeIcon style={menuIconStyle} />,
      disabled: isEditingActive,
      confirm: {
        message: t('features.chatConversationList.conversationItem.menu.makePublicConfirm', 'Are you sure to make your conversation public?'),
        confirmLabel: t('features.chatConversationList.conversationItem.menu.makePublic', 'Make public'),
        onConfirm: params.onMakePublic,
      },
    });
  }

  if (!isPersonal) {
    items.push({
      key: 'share',
      label: t('features.chatConversationList.conversationItem.menu.share', 'Share'),
      icon: (
        <Box sx={secondaryFillSx}>
          <CopyLinkIcon style={menuIconStyle} />
        </Box>
      ),
      onClick: params.onShare,
    });
  }

  items.push({
    key: 'playback',
    label: t('features.chatConversationList.conversationItem.menu.playback', 'Playback'),
    icon: <PlayIcon style={menuIconStyle} />,
    disabled: isEditingActive,
    onClick: params.onPlayback,
  });

  items.push({
    key: 'pin',
    label: conversation.isPinned === true ? t('features.chatConversationList.conversationItem.menu.unpin', 'Unpin') : t('features.chatConversationList.conversationItem.menu.pin', 'Pin on top'),
    icon: <PinIcon style={menuIconStyle} />,
    disabled: conversation.isPinned !== true && conversation.folderId !== undefined,
    onClick: params.onPin,
  });

  return items;
}
