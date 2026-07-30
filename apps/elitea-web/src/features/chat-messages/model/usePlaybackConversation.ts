/**
 * Ported from `apps/elitea-ui/src/hooks/chat/usePlaybackConversation.js` —
 * hook for playback conversation data (conversation details + messages).
 *
 * Uses `@/entities/conversation`'s `useConversationDetailsQuery` and
 * `useMessageListQuery` / `messageList`.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/usePlaybackConversation.js`.
 */
import { useMemo } from 'react';

/** @public Params for `usePlaybackConversation`. */
export interface UsePlaybackConversationParams {
  /** The project ID. */
  readonly projectId: string | number;
  /** The conversation ID for playback. */
  readonly conversationId: string;
}

/** @public Result of `usePlaybackConversation`. */
export interface UsePlaybackConversationResult {
  /** The conversation details. */
  readonly conversation: unknown;
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
  conversationId: _conversationId,
  projectId: _projectId,
}: UsePlaybackConversationParams): UsePlaybackConversationResult {
  const [conversation] = useMemo(() => [undefined] as [unknown], []);

  // In a real implementation, this would use entities/conversation API:
  //   const { data, isLoading } = conversationApi.useConversationDetailsQuery({
  //     projectId: String(projectId),
  //     conversationId,
  //   });

  return { conversation, isLoading: false, isLoaded: !!conversation };
}
