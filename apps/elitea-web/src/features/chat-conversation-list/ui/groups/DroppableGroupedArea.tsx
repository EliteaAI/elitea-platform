import type { ReactNode } from 'react';

import { useDroppable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

const UNGROUPED_DROPPABLE_ID = 'ungrouped-conversations';

export interface DroppableGroupedAreaProps {
  readonly children: ReactNode;
  readonly isDropDisabled?: boolean | undefined;
  readonly isValidDropTarget?: boolean | undefined;
  readonly isActive?: boolean | undefined;
}

interface OverlayState {
  readonly shouldShowDropFeedback: boolean;
  readonly showPassiveHighlight: boolean;
  readonly showInvalidTargetOverlay: boolean;
}

/** Extracted purely to keep `DroppableGroupedArea` under the §3.5 complexity budget (12) — same 3-state derivation the baseline computes inline. */
function resolveOverlayState(isOver: boolean, isActive: boolean, isValidDropTarget: boolean): OverlayState {
  return {
    shouldShowDropFeedback: isOver && isActive && isValidDropTarget,
    showPassiveHighlight: isValidDropTarget && isActive && !isOver,
    showInvalidTargetOverlay: !isValidDropTarget && isActive,
  };
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * groups/DroppableGroupedArea.jsx` (unit C2) — the ungrouped-conversations
 * drop target. Near-identical to the sibling `ui/folders` cluster's own
 * `DroppableFolderItem` (same 3-state overlay markup: active drop feedback /
 * passive valid-target highlight / dimmed invalid-target), except this one
 * hardcodes the `'ungrouped-conversations'` droppable id and carries no
 * `folder` payload, matching the baseline's own "Droppable area for
 * ungrouped conversations" doc comment.
 *
 * Colour/radius values are re-derived from this app's brand tokens rather
 * than copied from the baseline's raw hex/rgba literals — `elitea/
 * no-raw-color` / `no-theme-palette` / `ad-hoc-radius` are hard lint errors
 * here with no equivalent in the old app's toolchain, and the baseline's
 * `${theme.palette.primary.main}15`-style hex-alpha suffixes would not even
 * be valid CSS once `primary.main` resolves to a `var(--el-...)` reference
 * instead of a hex string. Substitutions, each already an existing token in
 * `shared/brand/tokens/palette.augment.d.ts`:
 *  - `background.dragging` (a token literally named for this "active drag
 *    target" wash) + `boxShadow.default` replace the manual glow/wash.
 *  - `border.hover` replaces the passive-highlight border tint.
 *  - `action.disabledBackground` (MUI's own dimmed-overlay token) replaces
 *    the invalid-target `rgba(0,0,0,0.3)` scrim.
 */
export function DroppableGroupedArea({ children, isDropDisabled = false, isValidDropTarget = true, isActive = true }: DroppableGroupedAreaProps): ReactNode {
  const { isOver, setNodeRef } = useDroppable({
    id: UNGROUPED_DROPPABLE_ID,
    disabled: isDropDisabled || !isValidDropTarget,
    data: { type: 'ungrouped' },
  });

  const { shouldShowDropFeedback, showPassiveHighlight, showInvalidTargetOverlay } = resolveOverlayState(isOver, isActive, isValidDropTarget);

  return (
    <Box
      sx={(theme: Theme) => ({
        // Padding when drag is active, so the border overlay has room to draw.
        padding: shouldShowDropFeedback || showPassiveHighlight ? theme.spacing(0.25) : 0,
        transition: 'padding 0.2s ease-in-out',
      })}
    >
      <Box
        ref={setNodeRef}
        sx={(theme: Theme) => ({
          position: 'relative',
          minHeight: '3.125rem',
          borderRadius: theme.vars.shape.radiusSm,
          transition: 'all 0.2s ease-in-out',
        })}
      >
        {children}

        {shouldShowDropFeedback && (
          <Box
            data-testid="drop-feedback-overlay"
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
            data-testid="passive-highlight-overlay"
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
            data-testid="invalid-target-overlay"
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
