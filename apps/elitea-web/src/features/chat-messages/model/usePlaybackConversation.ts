/**
 * Ported from `apps/elitea-ui/src/hooks/chat/usePlaybackConversation.js` —
 * hook for playback conversation data (conversation details + messages).
 *
 * Uses `@/entities/conversation`'s `conversationApi.useDetails` /
 * `conversationApi.useMessageList`, and this feature's own
 * `convertMessagesToChatHistory` to build `chat_history` from the fetched
 * message groups.
 *
 * **DISCLOSED SCOPE CUTS** (no equivalent global store slot exists yet for
 * either):
 *  - the baseline hook also dispatches Redux `setActiveConversation`/
 *    `setFolders`/`setConversations` and clears the URL conversation param
 *    once the fetch resolves — this port only fetches and returns the
 *    playback conversation, it does not write it anywhere.
 *  - the baseline passes a `{user, firstUserMessage}` `playerInfo` into
 *    `convertMessagesToChatHistory` so the current user's own messages are
 *    rendered via `convertToPlayerQuestion` (player-specific name/avatar);
 *    with no Redux `user` available here, this port omits `playerInfo` and
 *    falls back to the plain `normaliseUserMessage` conversion for every
 *    user message instead.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/usePlaybackConversation.js`.
 */
import { useMemo } from 'react';

import { conversationApi } from '@/entities/conversation';
import { unwrapListPage } from '@/shared/api/unwrap';

import type { ConversationWire } from '@/entities/conversation/api/conversationApi';
import type { MessageGroupWire, MessageParticipantWire } from '@/entities/message/lib/wire';

import { convertMessagesToChatHistory } from '../lib/convertMessagesToChatHistory';

/** Playback loads the full conversation at once (no incremental pagination) — matches the old app's `PLAYBACK_PAGE_SIZE` (`usePlaybackConversation.js:16`). */
const PLAYBACK_PAGE_SIZE = 100;

/** @public Params for `usePlaybackConversation`. */
export interface UsePlaybackConversationParams {
  /** The project ID. */
  readonly projectId: string | number;
  /** The conversation ID for playback. */
  readonly conversationId: string;
}

/** @public Result of `usePlaybackConversation`. */
export interface UsePlaybackConversationResult {
  /** The conversation details, enriched with `chat_history`/`messages_count` for playback. */
  readonly conversation: ConversationWire | undefined;
  /** Whether the conversation is loading. */
  readonly isLoading: boolean;
  /** Whether the conversation has loaded. */
  readonly isLoaded: boolean;
}

/**
 * `usePlaybackConversation` — loads conversation details for playback mode.
 * Unlike the live-chat path, playback loads the full conversation at once
 * (no pagination) since it's a historical replay.
 */
export function usePlaybackConversation({
  conversationId,
  projectId,
}: UsePlaybackConversationParams): UsePlaybackConversationResult {
  const detailsQuery = conversationApi.useDetails({ projectId, id: conversationId });
  const messageListQuery = conversationApi.useMessageList({
    projectId,
    conversationId,
    page: 0,
    pageSize: PLAYBACK_PAGE_SIZE,
    params: { sort_by: 'created_at', sort_order: 'asc' },
  });

  const conversation = useMemo<ConversationWire | undefined>(() => {
    if (!detailsQuery.data) return undefined;

    // The message list is `{items,total,page,…}` (measured), so the old
    // `'rows' in response ? response.rows : response` matched NEITHER arm and
    // handed the envelope object itself to convertMessagesToChatHistory — the
    // #132 shape, with the worst possible fallback (the input). unwrapListPage
    // handles items/rows/bare-array and falls back to [] (R-A6).
    const { rows, total } = unwrapListPage<unknown>(messageListQuery.data, 'conversation.messageList');

    const chatHistory = convertMessagesToChatHistory(
      rows as unknown as readonly MessageGroupWire[],
      (detailsQuery.data.participants ?? []) as unknown as readonly MessageParticipantWire[],
    );

    return {
      ...detailsQuery.data,
      chat_history: chatHistory,
      messages_count: total,
    };
  }, [detailsQuery.data, messageListQuery.data]);

  const isLoading = detailsQuery.isLoading || messageListQuery.isLoading;

  return { conversation, isLoading, isLoaded: !!conversation };
}
