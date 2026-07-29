import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Conversation } from '@/entities/conversation';

import { computePositionAtTopOfUnpinned, computePositionBetweenNeighbors, useDragAndDrop } from './useDragAndDrop';
import type { FolderListItem } from './conversationListState.types';

function mkConv(overrides: Partial<Conversation> & { readonly id: string }): Conversation {
  return { name: overrides.id, isPrivate: true, ...overrides };
}

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string; readonly conversations: readonly Conversation[] }): FolderListItem {
  return { name: overrides.id, ...overrides };
}

function dragStart(id: string) {
  return { active: { id, data: { current: undefined }, rect: { current: { initial: null, translated: null } } } } as never;
}

function dragEnd(activeId: string, overId: string | undefined, overData?: unknown) {
  return {
    active: { id: activeId, data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    over: overId === undefined ? null : { id: overId, data: { current: overData }, rect: {} },
  } as never;
}

describe('computePositionBetweenNeighbors', () => {
  it('averages both neighbours when both present', () => expect(computePositionBetweenNeighbors(10, 20)).toBe(15));
  it('halves the neighbour above when only it is present', () => expect(computePositionBetweenNeighbors(10, undefined)).toBe(5));
  it('adds POSITION_GAP below the neighbour below when only it is present', () => expect(computePositionBetweenNeighbors(undefined, 10)).toBe(1_000_010));
  it('defaults to 0 with no neighbours', () => expect(computePositionBetweenNeighbors(undefined, undefined)).toBe(0));
});

describe('computePositionAtTopOfUnpinned', () => {
  it('prefers posBelow + GAP when present', () => expect(computePositionAtTopOfUnpinned(10, 20)).toBe(1_000_020));
  it('falls back to posAbove + GAP', () => expect(computePositionAtTopOfUnpinned(10, undefined)).toBe(1_000_010));
  it('defaults to 0 with neither', () => expect(computePositionAtTopOfUnpinned(undefined, undefined)).toBe(0));
});

describe('useDragAndDrop', () => {
  it('happy path: dragging an ungrouped conversation onto a folder calls onMoveToFolderConversation with that folder', async () => {
    const conv1 = mkConv({ id: 'conv1' });
    const folderA = mkFolder({ id: 'fA', conversations: [] });
    const onMoveToFolderConversation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDragAndDrop({ onMoveToFolderConversation, folders: [folderA], conversations: [conv1], toastError: vi.fn() }),
    );

    act(() => result.current.handleDragStart(dragStart('conv1')));
    expect(result.current.draggedItems).toEqual([conv1]);

    await act(async () => {
      await result.current.handleDragEnd(dragEnd('conv1', 'folder-fA'));
    });

    expect(onMoveToFolderConversation).toHaveBeenCalledWith(conv1, folderA);
    expect(result.current.activeId).toBeNull();
    expect(result.current.draggedItems).toEqual([]);
  });

  it('error path: a rejected move surfaces the generic toastError message', async () => {
    const conv1 = mkConv({ id: 'conv1' });
    const folderA = mkFolder({ id: 'fA', conversations: [] });
    const onMoveToFolderConversation = vi.fn().mockRejectedValue(new Error('network down'));
    const toastError = vi.fn();

    const { result } = renderHook(() => useDragAndDrop({ onMoveToFolderConversation, folders: [folderA], conversations: [conv1], toastError }));

    act(() => result.current.handleDragStart(dragStart('conv1')));
    await act(async () => {
      await result.current.handleDragEnd(dragEnd('conv1', 'folder-fA'));
    });

    expect(toastError).toHaveBeenCalledWith('Error moving conversations');
  });

  it('distinctive rule: playback and pinned conversations are never moved, even when dropped on a valid folder', async () => {
    const playback = mkConv({ id: 'p1', isPlayback: true });
    const pinned = mkConv({ id: 'pin1', isPinned: true });
    const folderA = mkFolder({ id: 'fA', conversations: [] });
    const onMoveToFolderConversation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDragAndDrop({ onMoveToFolderConversation, folders: [folderA], conversations: [playback, pinned], toastError: vi.fn() }),
    );

    act(() => result.current.handleDragStart(dragStart('p1')));
    await act(async () => {
      await result.current.handleDragEnd(dragEnd('p1', 'folder-fA'));
    });
    expect(onMoveToFolderConversation).not.toHaveBeenCalled();

    act(() => result.current.handleDragStart(dragStart('pin1')));
    await act(async () => {
      await result.current.handleDragEnd(dragEnd('pin1', 'folder-fA'));
    });
    expect(onMoveToFolderConversation).not.toHaveBeenCalled();
  });

  it('distinctive rule: a conversation is not moved while a playback snapshot of it exists anywhere', async () => {
    const original = mkConv({ id: 'c1' });
    const playbackSnapshot = mkConv({ id: 'c1', isPlayback: true });
    const folderA = mkFolder({ id: 'fA', conversations: [playbackSnapshot] });
    const onMoveToFolderConversation = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDragAndDrop({ onMoveToFolderConversation, folders: [folderA], conversations: [original], toastError: vi.fn() }),
    );

    act(() => result.current.handleDragStart(dragStart('c1')));
    await act(async () => {
      await result.current.handleDragEnd(dragEnd('c1', 'folder-fA'));
    });

    expect(onMoveToFolderConversation).not.toHaveBeenCalled();
  });

  it('a stale drag-end (active id differs from the tracked activeId) resets state without calling anything', async () => {
    const conv1 = mkConv({ id: 'conv1' });
    const folderA = mkFolder({ id: 'fA', conversations: [] });
    const onMoveToFolderConversation = vi.fn();

    const { result } = renderHook(() =>
      useDragAndDrop({ onMoveToFolderConversation, folders: [folderA], conversations: [conv1], toastError: vi.fn() }),
    );

    act(() => result.current.handleDragStart(dragStart('conv1')));
    await act(async () => {
      await result.current.handleDragEnd(dragEnd('someone-else', 'folder-fA'));
    });

    expect(onMoveToFolderConversation).not.toHaveBeenCalled();
    expect(result.current.activeId).toBeNull();
  });

  it('folder reordering: dragging one folder onto another calls onReorderFolders with the recomputed order', async () => {
    const folderA = mkFolder({ id: 'fA', conversations: [], position: 10 });
    const folderB = mkFolder({ id: 'fB', conversations: [], position: 20 });
    const onReorderFolders = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDragAndDrop({
        onMoveToFolderConversation: vi.fn(),
        onReorderFolders,
        folders: [folderA, folderB],
        conversations: [],
        toastError: vi.fn(),
      }),
    );

    act(() => result.current.handleDragStart(dragStart('folder-fA')));
    expect(result.current.isDragging).toBe(true);

    await act(async () => {
      await result.current.handleDragEnd(dragEnd('folder-fA', 'folder-fB'));
    });

    expect(onReorderFolders).toHaveBeenCalledTimes(1);
    const submitted = onReorderFolders.mock.calls[0]?.[0] as readonly FolderListItem[];
    // `arrayMove(folders, 0, 1)` moves index-0 to index-1: [fA, fB] -> [fB, fA].
    expect(submitted.map((f) => f.id)).toEqual(['fB', 'fA']);
  });

  it('getDropAreaState: not a valid drop target while nothing is being dragged', () => {
    const { result } = renderHook(() => useDragAndDrop({ onMoveToFolderConversation: vi.fn(), folders: [], conversations: [], toastError: vi.fn() }));
    expect(result.current.getDropAreaState('folder-fA')).toEqual({ isValidDropTarget: false, isActive: false });
  });

  it('getDropAreaState: the ungrouped area is a valid target only when dragging FROM a folder', () => {
    const conv1 = mkConv({ id: 'conv1', folderId: 'fA' });
    const folderA = mkFolder({ id: 'fA', conversations: [conv1] });
    const { result } = renderHook(() =>
      useDragAndDrop({ onMoveToFolderConversation: vi.fn(), folders: [folderA], conversations: [], toastError: vi.fn() }),
    );

    act(() => result.current.handleDragStart(dragStart('conv1')));
    expect(result.current.getDropAreaState('ungrouped-conversations')).toEqual({ isValidDropTarget: true, isActive: true });
  });
});
