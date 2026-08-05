import type { ReactNode } from 'react';

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { DropAreaState } from '../../lib/hooks/useDragAndDrop';
import type { RenderConversationItem } from '../groups/DateGroup';
import { FolderItem } from '../folders/FolderItem';
import type { FolderDragAndDropProps, FolderItemCallbacks, FolderLoadMoreProps, FolderMoveTargetCallbacks } from '../folders/FolderItem';
import { computeFolderActivity } from './Conversations.helpers';
import type { ConversationsFolder } from './Conversations.types';

/**
 * `renderFoldersSection`'s body (`Conversations.tsx`, née `Folders.jsx`'s
 * `renderFolderItems`/`folderIds`), split out purely to keep
 * `Conversations.tsx` under the §3.5 `max-lines`/`complexity` budgets — a
 * plain function (not a hook) taking every closure value as an explicit
 * param, called from inside a `useCallback` at the call site instead.
 */
export interface RenderFoldersSectionParams {
  readonly sectionFolders: readonly ConversationsFolder[];
  readonly isPinnedSection: boolean;
  readonly hoveredFolderId: string | null;
  readonly selectedConversationId: string | undefined;
  readonly ungroupedConversationsCount: number;
  readonly enableDragAndDrop: boolean;
  readonly isSearchMode: boolean;
  readonly isFolderOperationInProgress: boolean;
  readonly getDropAreaState: (dropAreaId: string) => DropAreaState;
  readonly onFolderHover: (folderId: string, isHovered: boolean) => void;
  readonly projectId: string | undefined;
  readonly renderConversationItem: RenderConversationItem;
  readonly loadingFolders: ReadonlySet<string>;
  readonly onLoadMoreInFolder: (folderId: string) => void;
  readonly callbacks: FolderItemCallbacks;
  readonly moveTarget: FolderMoveTargetCallbacks;
  /** Bumped by `useRenderFoldersSection` whenever search mode is exited — folded into `FolderItem`'s own `key` below so React fully remounts it, the only way to reset `FolderAccordion`'s one-way expansion state (see that hook's own doc comment). */
  readonly forceRerenderKey: number;
}

function buildFolderItem(params: RenderFoldersSectionParams, folder: ConversationsFolder, nextFolder: ConversationsFolder | undefined): ReactNode {
  const { hoveredFolderId, selectedConversationId, ungroupedConversationsCount, enableDragAndDrop, isSearchMode, isFolderOperationInProgress, isPinnedSection, getDropAreaState, onFolderHover, projectId, renderConversationItem, loadingFolders, onLoadMoreInFolder, callbacks, moveTarget, forceRerenderKey } = params;

  const { isActive, shouldExpandByDefault } = computeFolderActivity(folder, selectedConversationId, ungroupedConversationsCount);
  const dragAndDrop: FolderDragAndDropProps = {
    enableDragAndDrop,
    isDragDisabled: isSearchMode || isFolderOperationInProgress || isPinnedSection,
    getDropAreaState,
    isNextFolderHovered: nextFolder?.id === hoveredFolderId,
    onFolderHover,
  };
  const loadMore: FolderLoadMoreProps = { onLoadMoreInFolder: () => onLoadMoreInFolder(folder.id), isLoadingMoreInFolder: loadingFolders.has(folder.id) };

  return (
    <FolderItem
      key={`${folder.id}-${forceRerenderKey}`}
      folder={folder}
      projectId={projectId}
      isActive={isActive}
      containsActiveConversation={shouldExpandByDefault}
      renderConversationItem={renderConversationItem}
      callbacks={callbacks}
      moveTarget={moveTarget}
      dragAndDrop={dragAndDrop}
      loadMore={loadMore}
    />
  );
}

export function renderFoldersSectionImpl(params: RenderFoldersSectionParams): ReactNode {
  const { sectionFolders, isPinnedSection, enableDragAndDrop, isSearchMode } = params;

  const items = sectionFolders.map((folder, index) => buildFolderItem(params, folder, sectionFolders[index + 1]));

  // Baseline `folderIds` (`Folders.jsx:55-59`): folder reordering is only offered outside search mode and never for the pinned section.
  const folderIds = enableDragAndDrop && !isSearchMode && !isPinnedSection ? sectionFolders.map((folder) => `folder-${folder.id}`) : [];
  if (folderIds.length === 0) return <>{items}</>;

  return (
    <SortableContext
      items={folderIds}
      strategy={verticalListSortingStrategy}
    >
      {items}
    </SortableContext>
  );
}
