/**
 * "Which conversation, if any, is being REPLAYED right now."
 *
 * Split out of `ChatWithEditors.tsx` so the rule — playback needs BOTH the
 * flag and a conversation — is testable without mounting the whole chat
 * surface. `?playback=1` on bare `/chat` names nothing to replay, and
 * rendering the playback surface for it would show a permanently empty box
 * rather than the chat the user asked for.
 *
 * Both reads are `strict: false`, this app's established convention for a
 * component that must not depend on which route file mounts it.
 */
import { useParams, useSearch } from '@tanstack/react-router';

interface PlaybackSearch {
  playback?: string;
}

interface ConversationParams {
  conversationId?: string;
}

/** The rule itself, as a pure function — `useSearch`/`useParams` supply the two inputs. */
export function playbackConversationId(
  playbackFlag: string | undefined,
  conversationId: string | undefined,
): string | undefined {
  if (playbackFlag !== '1') return undefined;
  if (conversationId === undefined || conversationId === '') return undefined;
  return conversationId;
}

export function usePlaybackConversationId(): string | undefined {
  const search = useSearch({ strict: false }) as PlaybackSearch;
  const params = useParams({ strict: false }) as ConversationParams;
  return playbackConversationId(search.playback, params.conversationId);
}
