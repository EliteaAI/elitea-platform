import { describe, expect, it } from 'vitest';

import { computeFoldersOrderForDrop, computePositionAtTopOfUnpinned, computePositionBetweenNeighbors, folderIdMatches, resolveFolderReorderTargets } from './useDragAndDrop.positioning';
import type { FolderListItem } from './conversationListState.types';

function mkFolder(overrides: Partial<FolderListItem> & { readonly id: string }): FolderListItem {
  return { name: overrides.id, conversations: [], ...overrides };
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

describe('folderIdMatches', () => {
  it('matches by string(id) equality', () => {
    expect(folderIdMatches(mkFolder({ id: 'fA' }), 'fA')).toBe(true);
    expect(folderIdMatches(mkFolder({ id: 'fA' }), 'fB')).toBe(false);
  });
});

describe('computeFoldersOrderForDrop', () => {
  it('reorders by array position for a normal (non-pinned-target) drop', () => {
    const a = mkFolder({ id: 'a', position: 10 });
    const b = mkFolder({ id: 'b', position: 20 });
    const result = computeFoldersOrderForDrop([a, b], 'a', 0, 1, undefined, true);
    expect(result.map((f) => f.id)).toEqual(['b', 'a']);
  });

  it('routes an unpinned folder dropped onto the pinned section through the "top of unpinned" placement', () => {
    const pinned = mkFolder({ id: 'p1', isPinned: true, position: 100 });
    const dragged = mkFolder({ id: 'd1', position: 5 });
    const other = mkFolder({ id: 'o1', position: 1 });
    const result = computeFoldersOrderForDrop([pinned, dragged, other], 'd1', 1, 0, true, true);
    expect(result.map((f) => f.id)).toEqual(['p1', 'd1', 'o1']);
    expect(result[1]).toMatchObject({ neighbor_above_id: 'p1', neighbor_below_id: 'o1' });
  });
});

describe('resolveFolderReorderTargets', () => {
  it('returns the resolved dragged/target folder pair with their indices', () => {
    const a = mkFolder({ id: 'a' });
    const b = mkFolder({ id: 'b' });
    const result = resolveFolderReorderTargets([a, b], 'folder-a', 'folder-b', undefined);
    expect(result).toMatchObject({ draggedFolderId: 'a', draggedFolderIndex: 0, targetFolderIndex: 1, targetFolder: b });
  });

  it('returns undefined when the dragged folder cannot be resolved', () => {
    const a = mkFolder({ id: 'a' });
    const result = resolveFolderReorderTargets([a], 'folder-unknown', 'folder-a', undefined);
    expect(result).toBeUndefined();
  });
});
