/**
 * lib/chatStreamMessageSyncFrames.ts — the message-sync family.
 *
 * Owns `chat_user_message`, the only frame in the vocabulary that produces a
 * USER message instead of advancing the assistant's, which is also why it is
 * the only one that resolves its own target rather than using the dispatcher's
 * `index`. A separate file because `chatStreamReducer.ts` exceeded the §3.5
 * file-length budget; the case and its comments are unchanged.
 */
import { convertJsonToString } from '@/shared/lib/json';
import { convertTime } from '@/entities/message/lib/normalise';
import { ROLES } from '@/shared/lib/enums';

import { nowIso, replaceAt, type ChatStreamContext } from './chatStreamShared';

import type { ChatMessage } from './convertMessagesToChatHistory';
import { SocketMessageType, type ChatStreamFrame } from './chatStreamFrame';

/**
 * Reduce one message-sync frame, or return `undefined` for a frame this family
 * does not own so the dispatcher can offer it to the next one.
 */
export function reduceMessageSyncFrame(
  history: readonly ChatMessage[],
  frame: ChatStreamFrame,
  type: string,
  context: ChatStreamContext,
): readonly ChatMessage[] | undefined {
  switch (type) {
    // The conversation echoing a USER question back over the stream — the one
    // frame in the vocabulary that produces a user message rather than
    // advancing the assistant's.
    //
    // Its id is `uuid`, NOT `message_id`, so `index` is meaningless here.
    case SocketMessageType.ChatUserMessage: {
      const id = frame.uuid;
      if (!id) return history;
      const participants = context.participants ?? [];
      const author = participants.find((participant) => participant.id === frame.author_participant_id);
      const sentTo = participants.find((participant) => participant.id === frame.sent_to_id);
      const createdAt = frame.created_at;

      const question: ChatMessage = {
        id,
        role: ROLES.User,
        // The baseline's LIVE resolution, which is barer than the persisted
        // path's `getMessageAuthorName` (email / "User <id>" / "User No Longer
        // Available" fallbacks). Reproduced rather than upgraded, for the same
        // reason as the swarm-child shape: the two paths render the same
        // conversation side by side.
        name: author?.meta?.user_name ?? '',
        avatar: author?.meta?.user_avatar ?? '',
        content: typeof frame.content === 'string' ? frame.content : convertJsonToString(frame.content ?? ''),
        // An ISO string, as `ChatMessage.createdAt` is typed and the persisted
        // builder produces — the baseline's epoch-ms number would render as a
        // different timestamp format for a live question than for a replayed one.
        createdAt: typeof createdAt === 'string' ? convertTime(createdAt) : nowIso(context),
        ...(frame.message_items !== undefined ? { messageItems: frame.message_items } : {}),
        ...(frame.author_participant_id !== undefined ? { userId: String(frame.author_participant_id) } : {}),
        ...(frame.sent_to_id !== undefined ? { participantId: String(frame.sent_to_id) } : {}),
        ...(sentTo !== undefined ? { sentTo } : {}),
      };

      // DEVIATION: the baseline appends unconditionally. Its own
      // `addMessageToChatHistory` guards the assistant path against exactly
      // this ("Guard against duplicate insertion", hooks.js:206-216) because
      // racing frames re-insert a message already in state; the user echo is
      // the un-guarded outlier, and an echo of a question already on screen
      // would render the user's own message twice. The same guard is applied
      // here rather than reproducing the omission.
      const existing = history.findIndex((message) => message.id === id);
      if (existing !== -1) return replaceAt(history, existing, question);
      return [...history, question];
    }

    default:
      return undefined;
  }
}
