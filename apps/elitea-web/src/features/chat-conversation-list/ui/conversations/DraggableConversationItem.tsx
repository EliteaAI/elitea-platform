import type { ReactNode } from 'react';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { asDragGroupAria } from '../../lib/dragAttributes';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Conversation } from '@/entities/conversation';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * conversations/DraggableConversationItem.jsx` (unit C2) — a thin
 * `@dnd-kit/core` `useDraggable` wrapper, pure positional passthrough.
 *
 * `React.memo` is dropped (the baseline wrapped the whole component in
 * `memo`): this codebase's other dnd-kit consumer (`src/smoke/
 * dndkit.smoke.test.tsx`) and every `shared/ui` component in this pass are
 * plain function components with no memoisation of their own — `memo` here
 * would buy nothing extra since `useDraggable`'s own returned `listeners`/
 * `attributes` are already stable per dnd-kit's own memoisation, and this
 * component's parent (`PinnedConversations`/`ConversationItem`) is the one
 * deciding whether/when to remount rows, not this wrapper.
 */
export interface DraggableConversationItemProps {
  readonly conversation: Conversation;
  readonly children: ReactNode;
  readonly isDragDisabled?: boolean;
  readonly isActive?: boolean;
}

export function DraggableConversationItem({ conversation, children, isDragDisabled = false, isActive = false }: DraggableConversationItemProps): ReactNode {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: conversation.id,
    disabled: isDragDisabled,
    data: {
      type: 'conversation',
      conversation,
    },
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragDisabled ? 'default' : 'grab',
    zIndex: isDragging ? 1000 : 'auto',
  };

  const sx: SxProps<Theme> = {
    position: 'relative',
    '&:active': {
      cursor: isDragDisabled ? 'default' : 'grabbing',
    },
    ...(!isDragDisabled && {
      '&:hover': {
        cursor: 'grab',
      },
    }),
    '&:has(+ .active-conversation) > *': {
      borderBottom: 'none',
    },
  };

  // `asDragGroupAria`: dnd-kit's ARIA bag describes a drag HANDLE, not a row
  // container that wraps its own buttons — see `lib/dragAttributes.ts`.
  return (
    <Box
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...asDragGroupAria(attributes)}
      sx={sx}
      className={isActive ? 'active-conversation' : ''}
    >
      {children}
    </Box>
  );
}
