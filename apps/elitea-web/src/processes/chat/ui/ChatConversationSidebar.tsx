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
 * `Conversations` owns its own width (`Conversations.tsx:286` switches
 * between `36px` collapsed and `100%`), so this file supplies only the
 * column that hosts it and the flex row that puts it beside the chat.
 */
import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Snackbar from '@mui/material/Snackbar';

import { Conversations } from '@/features/chat-conversation-list';
import { t } from '@/shared/i18n';

import { useConversationSidebar } from '../model/useConversationSidebar';

/** @public Rendered by `ChatWithEditors` as the left column of the chat surface. */
export function ChatConversationSidebar(): ReactNode {
  const { conversationsProps, errorMessage, onDismissError } = useConversationSidebar();

  return (
    <Box
      component="aside"
      aria-label={t('processes.chat.conversationSidebar.ariaLabel', 'Conversations')}
      data-testid="chat-conversation-sidebar"
      sx={{ flexShrink: 0, height: '100%', overflow: 'hidden', display: 'flex' }}
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
