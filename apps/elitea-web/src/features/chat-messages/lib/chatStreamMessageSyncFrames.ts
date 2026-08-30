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
 * Match a roster participant against an id the frame states.
 *
 * String-normalised on BOTH sides, exactly as the persisted path does
 * (`entities/message/lib/normalise.ts`'s `normaliseUserMessage`:
 * `String(user.id) === String(messageGroup.author_participant_id)`). The two
 * spellings genuinely coexist on the wire — the Go payloads state participant
 * ids as NUMBERS while the socket-era payloads this frame vocabulary was
 * captured from stated them as STRINGS, which is why `ChatStreamFrame` types
 * `author_participant_id`/`sent_to_id` as `string | number` while
 * `MessageParticipantWire.id` is typed `string`. A strict `===` across the two
 * resolves NO participant, silently.
 *
 * That single comparison governs three things together, so its failure is not
 * a cosmetic degradation: `name`, `avatar` AND `userId` all come off the
 * participant it finds, and a missing `userId` is what the edit and delete
 * controls gate on (`ChatMessageList`, `entities/message`'s
 * `canDeleteMessage`) — the live question loses its author's name, its avatar
 * and its own controls at once.
 *
 * `undefined` never matches: a frame that states no id must resolve nobody,
 * not a participant whose id stringifies to `"undefined"`.
 */
function isParticipant(participantId: string | number | undefined, statedId: string | number | undefined): boolean {
  if (participantId === undefined || statedId === undefined) return false;
  return String(participantId) === String(statedId);
}

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
      const author = participants.find((participant) => isParticipant(participant.id, frame.author_participant_id));
      // Same normalisation, same reason: `sent_to_id` crosses the same wire in
      // the same two spellings, and this row already writes
      // `participantId: String(frame.sent_to_id)` a few lines below — leaving
      // the LOOKUP strict while stringifying the value it stores was an
      // inconsistency inside one object literal.
      const sentTo = participants.find((participant) => isParticipant(participant.id, frame.sent_to_id));
      const createdAt = frame.created_at;
      // `ChatMessage.userId` is the AUTH USER id everywhere else in this app,
      // NOT the chat_participants row id `author_participant_id` states — the
      // two are different numbers (measured: participant row 1 carries
      // entity_meta.id 6). The persisted path
      // (`normalise.ts`'s `userOptionalFields`) writes
      // `String(foundUser.entity_meta.id)` and the optimistic path
      // (`useChatBoxHandlers.helpers.ts`'s `buildOptimisticUserMessage`) writes
      // `useGetCurrentAuthor().data.id`; every reader — `ChatMessageList`'s
      // edit/delete gating and `entities/message`'s `canDeleteMessage` —
      // compares against the same auth id. Writing the participant id here
      // instead produced a live question that could never match its own
      // author, silently losing its edit and delete controls.
      //
      // Resolved off the roster the author lookup above already did, and
      // OMITTED when it does not resolve: an unattributed row is the honest
      // answer, and falling back to the participant id would restate the very
      // mismatch this fixes.
      const authorUserId = author?.entity_meta?.id;

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
        ...(authorUserId !== undefined ? { userId: String(authorUserId) } : {}),
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
