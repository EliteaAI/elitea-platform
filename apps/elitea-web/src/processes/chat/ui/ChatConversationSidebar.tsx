/**
 * The chat conversation/folder rail — the mount point issue #128's residual
 * was about.
 *
 * `features/chat-conversation-list` exports `Conversations` (its own
 * `index.ts` calls it "the composition root other units will render"), and
 * until now nothing rendered it: the slice was complete, tested, and
 * unreachable. There was no "Create folder" control anywhere on `/chat`, so
 * the folder journey had nothing to click even though the folder BACKEND
 * round-trips correctly.
 *
 * **Why `processes/chat/ui/`.** `.dependency-cruiser.cjs` gives
 * `processes: ['app']` — only `app/` may import `processes/`, while
 * `processes/` may import `widgets/`, `pages/`, `features/`, `entities/`,
 * `shared/`. This root needs `features/chat-conversation-list` AND
 * `widgets/app-shell` (for the selected project) at once, so it belongs one
 * layer above both. Mounting it from `widgets/chat-box` would be the upward
 * import `no-upward-from-widgets` forbids, and mounting it from
 * `widgets/sidebar` would put chat-specific state in the global shell and
 * render it on every route. `ChatWithEditors.tsx`'s own module doc already
 * works through this same reasoning for the editors.
 *
 * `Conversations` owns its own width RELATIVE to this column
 * (`Conversations.tsx:286` switches between `36px` collapsed and `100%`), so
 * the column itself must state an absolute one — `100%` of an `auto`-width
 * flex item is just its content width. Without it the pane shrank to the
 * intrinsic width of its own header row, which is why the "Chats" title sat
 * flush against the nav rail with its first glyph clipped by the `overflow:
 * hidden` below, and why every conversation title was truncated.
 *
 * The numbers are the baseline's (`NewChat.jsx:182-186, 1744-1758`): a
 * 300px expanded column and a 60px collapsed one, each with a 24px right
 * gutter (`theme.spacing(3)`) before the conversation itself. The baseline widens the expanded
 * column to `380 - SIDE_BAR_WIDTH / 2` below a 1700px viewport; that second
 * rung is deliberately NOT ported here, because it is driven by
 * `useGetWindowWidth` + the Redux `sideBarCollapsed` flag and this app has
 * neither seam yet. 300px is the baseline's own value for every viewport
 * above 1700px and for a collapsed nav rail — a real rung of the baseline
 * scale, not an invented width.
 */
import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';

import { Conversations } from '@/features/chat-conversation-list';
import { t } from '@/shared/i18n';

import { useConversationSidebar } from '../model/useConversationSidebar';

/** Baseline `NewChat.jsx:1752-1757` — the expanded and collapsed column widths. */
const EXPANDED_WIDTH = '300px';
const COLLAPSED_WIDTH = '60px';

/** @public Rendered by `ChatWithEditors` as the left column of the chat surface. */
export function ChatConversationSidebar(): ReactNode {
  const { conversationsProps, errorMessage, onDismissError } = useConversationSidebar();
  const width = conversationsProps.collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

  return (
    <Box
      component="aside"
      aria-label={t('processes.chat.conversationSidebar.ariaLabel', 'Conversations')}
      data-testid="chat-conversation-sidebar"
      sx={{ flexShrink: 0, height: '100%', overflow: 'hidden', display: 'flex', width, pr: 3, boxSizing: 'content-box' }}
    >
      <Conversations {...conversationsProps} />

      {/*
        * This app has no global toast host (unlike the baseline's
        * `useToast()`), so the error seam every hook in the slice demands —
        * `toastError` — is surfaced here, the same local-Snackbar pattern
        * `features/settings/ui/system-prompts/ServicePromptsBody.tsx` already
        * uses. A swallowed folder error would otherwise be invisible.
        */}
      <Snackbar
        open={errorMessage !== undefined}
        autoHideDuration={6000}
        onClose={onDismissError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert severity="error" onClose={onDismissError} variant="filled">
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}
