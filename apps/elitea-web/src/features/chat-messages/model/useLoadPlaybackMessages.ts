/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useLoadPlaybackMessages.js` —
 * hook to load playback messages with pagination merge.
 *
 * Uses `@/entities/conversation`'s `useMessageListQuery` / `messageList`.
 * The pagination-merge orchestration ("load page N, append onto the running list")
 * is deliberately left out of the entities layer — this hook owns it.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useLoadPlaybackMessages.js`.
 */
import { useCallback, useState } from 'react';

import { conversationApi } from '@/entities/conversation';

import type { MessageGroupWire, MessageParticipantWire } from '@/entities/message/lib/wire';

import type { ChatMessage } from '../lib/convertMessagesToChatHistory';
import { convertMessagesToChatHistory } from '../lib/convertMessagesToChatHistory';

/** @public Params for `useLoadPlaybackMessages`. */
export interface UseLoadPlaybackMessagesParams {
  /** The project ID. */
  readonly projectId: string | number;
  /** The conversation ID. */
  readonly conversationId: string;
  /** Optional participant list for message conversion. */
  readonly participants?: readonly unknown[];
  /** Initial messages (for incremental loading). */
  readonly initialMessages?: readonly ChatMessage[];
}

/** @public Result of `useLoadPlaybackMessages`. */
export interface UseLoadPlaybackMessagesResult {
  /** The loaded chat messages. */
  readonly messages: readonly ChatMessage[];
  /** Whether messages are loading. */
  readonly isLoading: boolean;
  /** Whether all messages have been loaded. */
  readonly isComplete: boolean;
  /** Load the next page of messages. */
  readonly loadMore: () => Promise<void>;
  /** Error, if any. */
  readonly error?: unknown;
}

/**
 * `useLoadPlaybackMessages` — loads messages for playback mode with
 * pagination merge. Plays back a historical conversation by fetching
 * pages of messages and converting them to the chat message format.
 */
export function useLoadPlaybackMessages({
  projectId,
  conversationId,
  participants,
  initialMessages = [],
}: UseLoadPlaybackMessagesParams): UseLoadPlaybackMessagesResult {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<unknown>(undefined);

  const loadMore = useCallback(async () => {
    if (isLoading || isComplete) return;

    setIsLoading(true);
    setError(undefined);
    try {
      const response = await conversationApi.messageList({
        projectId: String(projectId),
        conversationId,
        page: Math.floor(messages.length / 10) + 1,
        pageSize: 10,
      });

      const rows = 'rows' in response ? response.rows : response;
      const convertedMessages = convertMessagesToChatHistory(
        rows as unknown as readonly MessageGroupWire[],
        participants as unknown as readonly MessageParticipantWire[],
      );

      // Merge: append new messages, deduplicate by ID.
      const existingIds = new Set(messages.map((m) => m.id));
      const newMessages = convertedMessages.filter((m) => !existingIds.has(m.id));
      setMessages((prev) => [...prev, ...newMessages]);

      if (newMessages.length === 0 || rows.length < 10) {
        setIsComplete(true);
      }
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isComplete, messages, projectId, conversationId, participants]);

  // Load initial page.
  if (initialMessages.length === 0 && !isLoading) {
    void loadMore();
  }

  return { messages, isLoading, isComplete, loadMore, error };
}
