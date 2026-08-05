/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useLoadMoreMessages.js` —
 * "load older messages" pagination for an open conversation: fetches page
 * N (10 rows/page) of `GET .../messages/prompt_lib/{projectId}/{conversationId}`
 * and prepends the newly-fetched (deduped) rows onto the current in-memory
 * chat history.
 *
 * **DEVIATIONS (disclosed):**
 *  1. `useSelectedProjectId()` (a `pages`-level hook, resolved internally by
 *     the baseline) -> an explicit `projectId` parameter. `processes/` may
 *     legally import `pages/`, but only through a slice's `index.ts`
 *     (R-L3), and no `pages/*` slice's public API exports its
 *     `useSelectedProjectId` duplicate today — the same "explicit parameter
 *     instead of an internal resolve" convention every sibling hook in this
 *     cluster (and `entities/participant`'s own hooks) already uses.
 *  2. `useLazyMessageListQuery` (RTK Query's imperative lazy-trigger form)
 *     -> `entities/conversation`'s plain async `conversationApi.messageList`
 *     fetcher, called directly inside the callback. TanStack Query (this
 *     app's data layer) has no RTK-style "lazy query hook" — calling the
 *     underlying fetcher imperatively IS the idiomatic TanStack equivalent
 *     for an on-demand, not-cached "load more" trigger (this exact function
 *     is also what `entities/conversation`'s own `useMessageListQuery`
 *     wraps for the cached/reactive case).
 *  3. `convertMessagesToChatHistory` (`common/convertChatConversationMessages.js`)
 *     is a not-yet-built C4 (chat-messages) unit's concern — taken as an
 *     injected parameter, mirroring `features/agents/lib/hooks/
 *     useApplicationChat.hooks.ts`'s established `onRemoteChatMessageSync`
 *     pattern for the identical "defer to C4 rather than inline ~300 lines
 *     or block on it" situation.
 *
 *     **Not present in this port at all (verified NOT a regression):** this
 *     unit's pinned old-app commit (`a55f36cf`, 2026-07-08) predates
 *     `useLoadMoreMessages.js` gaining a second fetch —
 *     `useLazyMessageTracesQuery` / `buildTraceListParams` /
 *     `groupTraceStepsByGroupId` (`common/convertChatConversationMessages.js`)
 *     — that pulls `message_trace_step` rows per loaded page and folds them
 *     into `convertMessagesToChatHistory`'s 4th arg so paged-in AI messages
 *     get their tool/thinking "pin" chips. That landed on `main` afterward
 *     (`e101ce04`, `e101ce04`'s "EL-5728" trace-pins commit, 2026-07-13;
 *     refined by `18715c20`, 2026-07-16) — a real old-app feature, just one
 *     this port's baseline never had. When C4 (issue #32) builds a real
 *     `convertMessagesToChatHistory`, it should also decide whether to pull
 *     that trace-fetch forward into this hook (same 3 functions, same
 *     `GET message_traces/prompt_lib/{projectId}/{conversationId}` call) —
 *     tracked here so it isn't silently lost.
 *  4. `toastError(buildErrorMessage(error))` -> an injected `onError`
 *     callback (this codebase's established "caller's seam for toast"
 *     convention — see `useChatCopyToClipboard.ts`'s module doc for the
 *     same disclosed substitution). The caller is free to run the payload
 *     through `shared/lib/http-error.ts`'s `buildErrorMessage` itself
 *     before surfacing it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { conversationApi } from '@/entities/conversation';

/** Loose, matching this cluster's established "no wire schema for raw chat state" convention (see `useChatCopyToClipboard.ts`'s `CopyableChatMessage`). */
export interface LoadMoreMessagesConversation {
  readonly id?: string | number;
  readonly messages_count?: number;
  readonly participants?: readonly unknown[];
}

export interface UseLoadMoreMessagesParams<TMessage> {
  readonly projectId: string | number | undefined;
  readonly activeConversation: LoadMoreMessagesConversation | undefined;
  readonly setChatHistory: (updater: (prev: readonly TMessage[]) => readonly TMessage[]) => void;
  readonly getMessageId: (message: TMessage) => string | number;
  /** `convertMessagesToChatHistory` — see module doc, deviation 3. */
  readonly convertMessagesToChatHistory: (rows: readonly unknown[], participants: readonly unknown[] | undefined) => readonly TMessage[];
  readonly onError?: (error: unknown) => void;
}

export interface UseLoadMoreMessagesResult {
  readonly onLoadMoreMessages: (callback?: () => void) => Promise<void>;
  readonly isLoadingMore: boolean;
}

function extractRows(response: Awaited<ReturnType<typeof conversationApi.messageList>>): readonly unknown[] {
  return 'rows' in response ? response.rows : response;
}

export function useLoadMoreMessages<TMessage>(params: UseLoadMoreMessagesParams<TMessage>): UseLoadMoreMessagesResult {
  const { projectId, activeConversation, setChatHistory, getMessageId, convertMessagesToChatHistory, onError } = params;

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  // Latest onError without pulling it into onLoadMoreMessages's own dep list (§3.5 hook-deps budget).
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const onLoadMoreMessages = useCallback(
    async (callback?: () => void): Promise<void> => {
      const messagesCount = activeConversation?.messages_count ?? 0;
      if (isLoadingMore || messagesCount <= page * 10 || activeConversation?.id === undefined || projectId === undefined) return;

      setIsLoadingMore(true);
      try {
        const response = await conversationApi.messageList({
          projectId,
          conversationId: activeConversation.id,
          page,
          pageSize: 10,
        });
        const rows = extractRows(response).slice().reverse();
        const olderMessages = convertMessagesToChatHistory(rows, activeConversation.participants);
        setChatHistory((prev) => {
          callback?.();
          const prevIds = new Set(prev.map(getMessageId));
          return [...olderMessages.filter((m) => !prevIds.has(getMessageId(m))), ...prev];
        });
      } catch (error) {
        onErrorRef.current?.(error);
      } finally {
        // Advances regardless of fetch outcome, matching the baseline (`setPage`/
        // `setIsLoadingMore(false)` sit outside its `if (result.data)` block) — a
        // failed page is skipped on retry rather than retried forever.
        setPage((prev) => prev + 1);
        setIsLoadingMore(false);
      }
    },
    [activeConversation, isLoadingMore, page, projectId, setChatHistory, getMessageId, convertMessagesToChatHistory],
  );

  useEffect(() => {
    setPage(1);
  }, [projectId]);

  useEffect(() => {
    setPage(1);
  }, [activeConversation?.id]);

  return { onLoadMoreMessages, isLoadingMore };
}
