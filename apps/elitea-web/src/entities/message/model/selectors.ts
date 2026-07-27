import type { AssistantMessage, Message } from './types';

/**
 * apps/elitea-ui/src/common/convertChatConversationMessages.js:12-19
 * `isUserMessage`, ported verbatim (also live at
 * hooks/chat/useSyncChatMessage.js:97-103): a message-group row is
 * attributed to the human user when its author OR its `sentTo` target is a
 * known user id, OR when it has neither a `sentToId` nor a `replyToId`
 * (an un-routed root message defaults to "from the user"), OR when a
 * `sentTo` object is present at all (truthy-checked, not shape-checked —
 * preserved as-is).
 */
export function isUserMessageRow(
  authorParticipantId: string | undefined,
  sentToId: string | undefined,
  userIds: readonly string[],
  replyToId: string | undefined,
  sentTo: unknown,
): boolean {
  return (
    (authorParticipantId !== undefined && userIds.includes(authorParticipantId)) ||
    (sentToId !== undefined && userIds.includes(sentToId)) ||
    (sentToId === undefined && replyToId === undefined) ||
    Boolean(sentTo)
  );
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/chat.helpers.js:52-56
 * `canDeleteThisAIMessage`, ported verbatim: only the user who asked the
 * question (found by `message.questionId` in `chatHistory`) may delete the
 * AI's answer to it.
 */
export function canDeleteMessage(chatHistory: readonly Message[], message: AssistantMessage, userId: string): boolean {
  const question = chatHistory.find((item) => item.id === message.questionId);
  return question !== undefined && question.role === 'user' && question.userId === userId;
}

/** An assistant message that is still receiving tokens or is otherwise pending. */
export function isMessageStreaming(message: Message): boolean {
  return message.role === 'assistant' && (message.isStreaming === true || message.isLoading === true);
}
