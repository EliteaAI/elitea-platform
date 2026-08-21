/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/
 * newConversation.helpers.js` (unit C1) — verbatim, pure functions.
 */
import { ChatParticipantType } from '@/shared/lib/chat';

import type { ChatParticipantWire, ConversationForHelpers } from './wire';

/** `newConversation.helpers.js:1-18`. */
export function extractHumanReadableName(email: string | undefined): string {
  if (!email) return '';
  const username = email.split('@')[0] ?? '';
  const cleanedUsername = username.replace(/[._-]/g, ' ');
  return cleanedUsername
    .split(' ')
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** `newConversation.helpers.js:20-23`. */
export function extractFirstName(fullName: string | undefined): string {
  if (!fullName) return '';
  return fullName.split(' ')[0] ?? '';
}

/**
 * True when `participant` is the chat participant row for `userId`.
 *
 * The comparison is on the STRING form of both ids on purpose. The participant
 * row carries `entity_meta.id` as a JSON number (`useChatBoxSend.ts` writes
 * `Number(userId)`, and the legacy pydantic model declares `id: int`), while
 * every caller supplies `userId` as a string (`/social/author` answers
 * `{"id":"5"}`). A strict `===` between the two is false for every row, so the
 * saved per-conversation model was never restored.
 *
 * The `undefined` guards are necessary. `String(undefined) === String(undefined)`
 * is true, so without them a participant with no `entity_meta.id` matches while
 * the author query is still loading.
 */
function isSameUser(participant: ChatParticipantWire, userId: string | undefined): boolean {
  if (participant.entity_name !== ChatParticipantType.Users) return false;
  const participantId = participant.entity_meta?.id;
  if (participantId === undefined || participantId === null || userId === undefined) return false;
  return String(participantId) === String(userId);
}

/** `newConversation.helpers.js:25-28`. */
export function getChatUserSettings(
  conversation: ConversationForHelpers | undefined,
  userId: string | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return conversation?.participants?.find((p) => isSameUser(p, userId))?.entity_settings?.llm_settings;
}

/** `newConversation.helpers.js:30-45`. */
export function setUserLLmSettings(
  participants: readonly ChatParticipantWire[] | undefined,
  userId: string | undefined,
  llmSettings: Readonly<Record<string, unknown>>,
): ChatParticipantWire[] {
  return (participants ?? []).map((p) => {
    if (!isSameUser(p, userId)) return p;
    return {
      ...p,
      entity_settings: {
        ...p.entity_settings,
        llm_settings: {
          ...p.entity_settings?.llm_settings,
          ...llmSettings,
        },
      },
    };
  });
}
