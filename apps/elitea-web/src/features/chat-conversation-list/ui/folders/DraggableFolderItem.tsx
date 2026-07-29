import type { CSSProperties, ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { FolderListItem } from '../../lib/hooks/conversationListState.types';

export interface DraggableFolderItemProps {
  readonly folder: FolderListItem;
  readonly children: ReactNode;
  readonly isDragDisabled?: boolean | undefined;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * folders/DraggableFolderItem.jsx` (unit C2/folders). `@dnd-kit/sortable`'s
 * `useSortable`, disabled while the folder is a not-yet-persisted draft
 * (`folder.isNew`) or the caller disables dragging outright — computed once
 * here and reused for both the hook's `disabled` option and the rendered
 * cursor (the baseline recomputed the same condition twice, once per use).
 *
 * The baseline's `getDragStyle` (`transform`/`opacity`/`cursor`/
 * `transition`/`zIndex`) is assigned to the native `style` attribute, not
 * `sx` — it never reads the theme, so there is nothing for `sx`'s
 * theme-function form to add; kept on `style` here too.
 */
export function DraggableFolderItem({ folder, children, isDragDisabled = false }: DraggableFolderItemProps): ReactNode {
  const disabled = isDragDisabled || folder.isNew === true;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: `folder-${folder.id}`,
    disabled,
    data: { type: 'folder', folder },
  });

  const dragStyle: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: disabled ? 'default' : 'grab',
    transition: isDragging ? 'opacity 0.2s ease-in-out' : 'opacity 0.2s ease-in-out, transform 0.2s ease-in-out',
    zIndex: isDragging ? 1000 : 'auto',
  };

  return (
    <Box
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...listeners}
      sx={containerSx(disabled)}
    >
      {children}
      {isDragging && (
        <Box
          data-testid="draggable-folder-item-overlay"
          sx={dragOverlaySx}
        />
      )}
    </Box>
  );
}

function containerSx(disabled: boolean): SxProps<Theme> {
  return {
    position: 'relative',
    '&:active': { cursor: disabled ? 'default' : 'grabbing' },
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };
}

/**
 * Colour tokens, not the baseline's raw `${palette.primary.main}10` hex-alpha
 * suffix: once `primary.main` resolves to a `var(--el-...)` reference
 * (rather than a hex string), appending digits to it is not valid CSS at
 * all — the same hazard the concurrently-built sibling `ui/groups/
 * DroppableGroupedArea.tsx` documents and fixes the identical way.
 * `background.dragging` (a token literally named for this "active drag"
 * wash) replaces the manual alpha suffix; `theme.vars.shape.radiusSm`
 * replaces the ad-hoc `0.375rem` radius literal.
 */
const dragOverlaySx: SxProps<Theme> = (theme: Theme) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  border: `0.125rem dashed ${theme.vars.palette.primary.main}`,
  borderRadius: theme.vars.shape.radiusSm,
  backgroundColor: theme.vars.palette.background.dragging,
  pointerEvents: 'none',
  zIndex: 1000,
});
