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

/** `newConversation.helpers.js:25-28`. */
export function getChatUserSettings(
  conversation: ConversationForHelpers | undefined,
  userId: string | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return conversation?.participants?.find((p) => p.entity_name === ChatParticipantType.Users && p.entity_meta?.id === userId)?.entity_settings
    ?.llm_settings;
}

/** `newConversation.helpers.js:30-45`. */
export function setUserLLmSettings(
  participants: readonly ChatParticipantWire[] | undefined,
  userId: string | undefined,
  llmSettings: Readonly<Record<string, unknown>>,
): ChatParticipantWire[] {
  return (participants ?? []).map((p) => {
    if (p.entity_name !== ChatParticipantType.Users || p.entity_meta?.id !== userId) return p;
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
