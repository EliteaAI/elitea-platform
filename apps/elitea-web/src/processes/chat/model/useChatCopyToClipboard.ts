/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useChatCopyToClipboard.js` —
 * extracts copyable content off a chat-history message (exception JSON,
 * joined `message_items[].content`, or plain `content`) and copies it to
 * the clipboard.
 *
 * **DEVIATION (disclosed):** the baseline called `useToast()`
 * (`toastInfo`/`toastError`) directly to surface a notification. This app
 * has no shared toast infrastructure yet (grepped `src/shared/**` — no
 * `useToast`/toast hook exists anywhere); every other hook in this codebase
 * that needs to notify the user returns its outcome and leaves surfacing it
 * to the caller instead (e.g. `features/agents/model/useCreateApplication.ts`'s
 * own doc comment: "the caller's seam for navigation/nav-blocker/toast").
 * This hook follows that same established convention: `onCopyToClipboard`
 * resolves to `true`/`false` (found-and-copied vs. not-found-or-failed)
 * rather than calling a toast itself; the caller (a future chat-message
 * widget) decides how to surface success/failure.
 *
 * Uses `shared/lib/clipboard.ts`'s already-landed `handleCopy` (unit S3)
 * rather than a second `navigator.clipboard.writeText` call site.
 */
import { useCallback } from 'react';

import { handleCopy } from '@/shared/lib/clipboard';

/** The subset of a chat-history row's shape this hook reads — loose, matching `features/agents/lib/hooks/applicationChat.types.ts`'s own `ChatHistoryMessage` convention (no wire schema exists for chat-history rows; see that file's doc comment). */
export interface CopyableChatMessage {
  readonly id: string | number;
  readonly exception?: unknown;
  readonly message_items?: readonly { readonly content?: string; readonly item_details?: { readonly content?: string } }[];
  readonly content?: unknown;
}

function extractCopyableContent(message: CopyableChatMessage): string {
  if (message.exception) return JSON.stringify(message.exception);
  if (message.message_items?.length) {
    return message.message_items
      .map((item) => item.content ?? item.item_details?.content ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return typeof message.content === 'string' ? message.content : '';
}

/**
 * Returns a curried copy handler: `onCopyToClipboard(messageId)` looks the
 * message up in `chatHistory`, extracts its copyable text, and copies it.
 * Resolves `false` (no-op, no throw) if the message id isn't found.
 */
export function useChatCopyToClipboard(chatHistory: readonly CopyableChatMessage[] | undefined): (id: string | number) => Promise<boolean> {
  return useCallback(
    async (id: string | number): Promise<boolean> => {
      const message = chatHistory?.find((item) => item.id === id);
      if (!message) return false;
      try {
        await handleCopy(extractCopyableContent(message));
        return true;
      } catch {
        return false;
      }
    },
    [chatHistory],
  );
}
