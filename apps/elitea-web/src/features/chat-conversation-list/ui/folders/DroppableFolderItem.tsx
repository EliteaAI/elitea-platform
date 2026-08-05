import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import { useDroppable } from '@dnd-kit/core';

import type { FolderListItem } from '../../lib/hooks/conversationListState.types';

interface DropOverlayFlags {
  readonly showDropFeedback: boolean;
  readonly showPassiveHighlight: boolean;
  readonly showInvalidTargetOverlay: boolean;
}

/** Extracted purely to keep `DroppableFolderItem`'s own cyclomatic complexity under the §3.5 budget (12) — the 3 `&&`-chains below move here instead of inline in the component body. */
function computeDropOverlayFlags(isOver: boolean, isActive: boolean, isValidDropTarget: boolean): DropOverlayFlags {
  return {
    showDropFeedback: isOver && isActive && isValidDropTarget,
    showPassiveHighlight: isValidDropTarget && isActive && !isOver,
    showInvalidTargetOverlay: !isValidDropTarget && isActive,
  };
}

export interface DroppableFolderItemProps {
  readonly folder: FolderListItem;
  readonly children: ReactNode;
  readonly isDropDisabled?: boolean | undefined;
  /** Whether the item CURRENTLY being dragged (elsewhere, by a sibling `useDragAndDrop.getDropAreaState` call) may legally land on this folder — e.g. `false` for the folder a conversation is already in. */
  readonly isValidDropTarget?: boolean | undefined;
  /** Whether a drag is in progress at all — every overlay branch below is gated on this so nothing renders outside a drag. */
  readonly isActive?: boolean | undefined;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * folders/DroppableFolderItem.jsx` (unit C2/folders). `@dnd-kit/core`'s
 * `useDroppable`, plus the baseline's 3 conditional overlay states, kept in
 * the same order:
 *  1. drop-feedback (dashed border + glow) — `isOver && isActive && isValidDropTarget`
 *  2. passive highlight for a still-valid, not-yet-hovered target — `isValidDropTarget && isActive && !isOver`
 *  3. dimmed overlay for an active drag that may not land here — `!isValidDropTarget && isActive`
 *
 * `isOver` comes from `useDroppable` itself (real `@dnd-kit` drag-over
 * state); `isValidDropTarget`/`isActive` are the caller's own precomputed
 * props (`useDragAndDrop.ts`'s `getDropAreaState(dropAreaId)` — see
 * `FolderItem.tsx`'s own call site), not derived here.
 *
 * Token substitutions mirror the sibling `ui/groups/DroppableGroupedArea.tsx`
 * (built concurrently, same unit) byte-for-byte rather than re-deriving them
 * independently — that file's own doc comment already explains why the
 * baseline's raw hex/rgba literals (`elitea/no-raw-color` /
 * `no-theme-palette` / `ad-hoc-radius`, hard lint errors with no old-app
 * equivalent) don't survive the port: `background.dragging` +
 * `boxShadow.default` replace the manual glow/wash, `border.hover` replaces
 * the passive-highlight border tint, and MUI's own
 * `action.disabledBackground` replaces the invalid-target
 * `rgba(0,0,0,0.3)` scrim. `DroppableGroupedArea` is not imported/reused
 * directly — it hardcodes the `'ungrouped-conversations'` droppable id and
 * carries no `folder` payload, so the two components differ at exactly the
 * `useDroppable({id, data})` call, not in the overlay markup.
 */
export function DroppableFolderItem({ folder, children, isDropDisabled = false, isValidDropTarget = true, isActive = true }: DroppableFolderItemProps): ReactNode {
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-${folder.id}`,
    disabled: isDropDisabled || !isValidDropTarget,
    data: { type: 'folder', folder },
  });

  const { showDropFeedback, showPassiveHighlight, showInvalidTargetOverlay } = computeDropOverlayFlags(isOver, isActive, isValidDropTarget);

  return (
    <Box
      sx={(theme: Theme) => ({
        // Padding when drag is active, so the border overlay has room to draw.
        padding: showDropFeedback || showPassiveHighlight ? theme.spacing(0.25) : 0,
        transition: 'padding 0.2s ease-in-out',
      })}
    >
      <Box
        ref={setNodeRef}
        sx={(theme: Theme) => ({
          position: 'relative',
          borderRadius: theme.vars.shape.radiusSm,
          transition: 'all 0.2s ease-in-out',
        })}
      >
        {children}

        {showDropFeedback && (
          <Box
            data-testid="droppable-folder-item-drop-feedback"
            sx={(theme: Theme) => ({
              position: 'absolute',
              inset: '-0.125rem',
              border: `0.125rem dashed ${theme.vars.palette.primary.main}`,
              borderRadius: theme.vars.shape.radiusMd,
              backgroundColor: theme.vars.palette.background.dragging,
              pointerEvents: 'none',
              zIndex: 999,
              boxShadow: theme.vars.palette.boxShadow.default,
            })}
          />
        )}

        {showPassiveHighlight && (
          <Box
            data-testid="droppable-folder-item-hover-ring"
            sx={(theme: Theme) => ({
              position: 'absolute',
              inset: '-0.0625rem',
              border: `0.0625rem solid ${theme.vars.palette.border.hover}`,
              borderRadius: theme.vars.shape.radiusSm,
              pointerEvents: 'none',
              zIndex: 998,
            })}
          />
        )}

        {showInvalidTargetOverlay && (
          <Box
            data-testid="droppable-folder-item-dimmed-invalid"
            sx={(theme: Theme) => ({
              position: 'absolute',
              inset: 0,
              backgroundColor: theme.vars.palette.action.disabledBackground,
              borderRadius: theme.vars.shape.radiusSm,
              pointerEvents: 'none',
              zIndex: 997,
            })}
          />
        )}
      </Box>
    </Box>
  );
}
