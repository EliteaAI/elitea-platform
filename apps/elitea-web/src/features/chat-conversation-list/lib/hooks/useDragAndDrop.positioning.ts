/**
 * Folder-position arithmetic + folder-id/index resolution for
 * `useDragAndDrop.ts` — split into its own file purely to keep
 * `useDragAndDrop.ts` under the §3.5 max-lines budget (400); every export
 * here is consumed only by that file (or its own co-located test),
 * matching this codebase's established precedent for exactly this
 * situation (e.g. `features/pipelines/ui/nodes/BaseNode/
 * NodeCardHeader.rename.ts`, split out of `NodeCardHeader.tsx` for the
 * same budget reason).
 */
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

import { isPinnedFolder } from '@/entities/folder';
import { POSITION_GAP } from '@/shared/lib/limits';

import type { FolderListItem } from './conversationListState.types';

export const FOLDER_ID_PREFIX = 'folder-';

/** `String(folder.id) === id` — the baseline's own `folderIdMatches` also tried `folder.id === parseInt(id, 10)` for a possibly-numeric folder id; `entities/folder`'s `Folder.id` is always `string` in this codebase's domain model, so that branch can never match and is dropped (disclosed simplification, not a behaviour change for any real folder). */
export function folderIdMatches(folder: FolderListItem, id: string): boolean {
  return String(folder.id) === id;
}

/** Ported from `hooks/chat/useDragAndDrop.js`'s module-level `computePositionBetweenNeighbors` — the new position for a folder dropped BETWEEN two existing (non-`isNew`) neighbours, or at an end. */
export function computePositionBetweenNeighbors(posAbove: number | undefined, posBelow: number | undefined): number {
  if (posAbove != null && posBelow != null) return Math.floor((posAbove + posBelow) / 2);
  if (posAbove != null) return Math.floor(posAbove / 2);
  if (posBelow != null) return posBelow + POSITION_GAP;
  return 0;
}

/** Ported from `hooks/chat/useDragAndDrop.js`'s module-level `computePositionAtTopOfUnpinned` — the new position for an unpinned folder dropped onto the pinned section (it lands at the TOP of the unpinned run, just below the last pinned folder). */
export function computePositionAtTopOfUnpinned(posAbove: number | undefined, posBelow: number | undefined): number {
  if (posBelow != null) return posBelow + POSITION_GAP;
  if (posAbove != null) return posAbove + POSITION_GAP;
  return 0;
}

function calculatePositionForDraggedFolder(foldersForReorder: readonly FolderListItem[], draggedFolderId: string): FolderListItem[] {
  const draggedFolderIndex = foldersForReorder.findIndex((f) => String(f.id) === draggedFolderId);
  if (draggedFolderIndex === -1) return [...foldersForReorder];

  const draggedFold = foldersForReorder[draggedFolderIndex];
  if (draggedFold === undefined || draggedFold.isNew === true) return [...foldersForReorder];

  const prevNonNewFolder = foldersForReorder.slice(0, draggedFolderIndex).reverse().find((f) => f.isNew !== true);
  const nextNonNewFolder = foldersForReorder.slice(draggedFolderIndex + 1).find((f) => f.isNew !== true);

  const neighborAboveId = prevNonNewFolder?.id ?? null;
  const neighborBelowId = nextNonNewFolder?.id ?? null;
  const newPosition = computePositionBetweenNeighbors(prevNonNewFolder?.position, nextNonNewFolder?.position);

  return foldersForReorder.map((folder, index) =>
    index === draggedFolderIndex
      ? { ...folder, position: newPosition, neighbor_above_id: neighborAboveId, neighbor_below_id: neighborBelowId }
      : folder,
  );
}

function calculatePositionWhenDroppedOnPinned(foldersList: readonly FolderListItem[], draggedFolderId: string): FolderListItem[] {
  const pinnedInOrder = foldersList.filter(isPinnedFolder);
  const lastPinned = pinnedInOrder.at(-1);
  const otherUnpinned = foldersList.filter((f) => !isPinnedFolder(f) && String(f.id) !== draggedFolderId);
  const firstUnpinned = otherUnpinned[0];

  const neighborAboveId = lastPinned?.id ?? null;
  const neighborBelowId = firstUnpinned?.id ?? null;
  const newPosition = computePositionAtTopOfUnpinned(lastPinned?.position, firstUnpinned?.position);

  const draggedFolderItem = foldersList.find((f) => folderIdMatches(f, draggedFolderId));
  if (draggedFolderItem === undefined) return [...foldersList];

  const draggedWithNewPosition: FolderListItem = {
    ...draggedFolderItem,
    position: newPosition,
    neighbor_above_id: neighborAboveId,
    neighbor_below_id: neighborBelowId,
  };

  return [...pinnedInOrder, draggedWithNewPosition, ...otherUnpinned];
}

export function computeFoldersOrderForDrop(
  foldersList: readonly FolderListItem[],
  draggedId: string,
  fromIndex: number,
  toIndex: number,
  targetPinned: boolean | undefined,
  draggedUnpinned: boolean,
): FolderListItem[] {
  if (targetPinned === true && draggedUnpinned) {
    return calculatePositionWhenDroppedOnPinned(foldersList, draggedId);
  }
  const reordered = arrayMove([...foldersList], fromIndex, toIndex);
  return calculatePositionForDraggedFolder(reordered, draggedId);
}

export interface FolderReorderTargets {
  readonly draggedFolderId: string;
  readonly draggedFolderData: FolderListItem;
  readonly draggedFolderIndex: number;
  readonly targetFolderIndex: number;
  readonly targetFolder: FolderListItem | undefined;
}

/** Resolves + validates the dragged/target folder pair for `handleFolderReordering` — extracted purely to keep that callback under the §3.5 complexity budget. Returns `undefined` when either index can't be found or the dragged folder itself isn't resolvable (baseline: the combined `areBothIndicesValid`/`!draggedFolderData` early return). */
export function resolveFolderReorderTargets(
  folders: readonly FolderListItem[],
  activeId: DragEndEvent['active']['id'],
  dropTargetId: string,
  overFolderData: FolderListItem | undefined,
): FolderReorderTargets | undefined {
  const targetIdFromOver = dropTargetId.slice(FOLDER_ID_PREFIX.length);
  const targetFolder = folders.find((f) => folderIdMatches(f, targetIdFromOver)) ?? overFolderData;

  const draggedFolderId = typeof activeId === 'string' ? activeId.slice(FOLDER_ID_PREFIX.length) : String(activeId);
  const draggedFolderData = folders.find((f) => folderIdMatches(f, draggedFolderId));

  const folderIdsForReordering = folders.map((folder) => `${FOLDER_ID_PREFIX}${folder.id}`);
  const draggedFolderIndex = folderIdsForReordering.indexOf(String(activeId));
  const targetFolderIndex = folderIdsForReordering.indexOf(dropTargetId);

  if (draggedFolderIndex === -1 || targetFolderIndex === -1 || draggedFolderData === undefined) return undefined;

  return { draggedFolderId, draggedFolderData, draggedFolderIndex, targetFolderIndex, targetFolder };
}
