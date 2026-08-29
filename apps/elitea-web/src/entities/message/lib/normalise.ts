import { ChatParticipantType } from '@/shared/lib/chat';
import { ROLES } from '@/shared/lib/enums';

import type { AssistantMessage, UserMessage } from '../model/types';
import { buildToolActions } from './toolActions';
import type {
  HitlInterruptRawWire,
  MessageAuthorWire,
  MessageGroupWire,
  MessageItemWire,
  MessageParticipantWire,
} from './wire';

/**
 * apps/elitea-ui/src/common/convertChatConversationMessages.js:21-33
 * `convertTime`, ported verbatim: normalises the persisted message-group
 * timestamp shapes into an ISO-parseable string —
 * `"YYYY-MM-DD HH:MM:SS"` (space-separated, Postgres-style) becomes
 * `"YYYY-MM-DDTHH:MM:SSZ"`; a string already ending in `Z` or already
 * carrying a `+` offset is returned as-is; anything else gets a bare `Z`
 * appended.
 */
export function convertTime(time: string): string {
  const timeStrings = time.split(' ');
  if (timeStrings.length > 1) {
    return `${timeStrings[0]}T${timeStrings[1]}Z`;
  }
  if (time.at(-1) === 'Z') {
    return time;
  }
  if (time.includes('+')) {
    return time;
  }
  return `${time}Z`;
}

// ── convertToUserQuestion (lines 35-82) ────────────────────────────────────

/**
 * `getUserName` (lines 53-62), ported — with the source's single "no user"
 * branch split in two, because the two things it conflated are not the same
 * claim.
 *
 * The source only ever reached that branch from a `message_group` that NAMED
 * an `author_participant_id` the `users` array could not resolve, which is
 * what "no longer available" asserts: this message had an author, and that
 * author is gone. `GET /elitea_core/messages/prompt_lib/{project}/{id}` —
 * what a conversation reload reads — answers flat rows carrying no author
 * field at all (measured: `{id, uid, conversation_id, role, content,
 * content_type, metadata, created_at}`), so every reloaded transcript fell
 * into it and captioned the reader's own question as a departed user.
 *
 * An author the endpoint never states is unknown, not absent, and '' says so
 * — the same value the LIVE path already produces for an unresolved author
 * (features/chat-messages/lib/chatStreamMessageSyncFrames.ts:51).
 *
 * '' is where the attribution STOPS: the renderer must not substitute one.
 * These rows carry no author identity of any kind (`userId` is omitted too,
 * below), so nothing downstream can tell the reader's own question apart from
 * anyone else's, and the reader's name on every bubble of a reloaded SHARED
 * conversation is a worse answer than no caption — see
 * `resolveAuthorCaption` in
 * `features/chat-messages/ui/chat-box/UserMessage.tsx`.
 */
function getMessageAuthorName(user: MessageAuthorWire | undefined, statesAnAuthor: boolean): string {
  if (!user) return statesAnAuthor ? 'User No Longer Available' : '';
  if (user.meta?.user_name) return user.meta.user_name;
  if (user.entity_meta?.email) return user.entity_meta.email;
  if (user.entity_meta?.id) return `User ${user.entity_meta.id}`;
  return 'User No Longer Available';
}

/** `sentTo` resolution (lines 74-78). */
function resolveSentTo(messageGroup: MessageGroupWire, foundParticipant: MessageParticipantWire | undefined): unknown {
  if (foundParticipant) return foundParticipant;
  if (messageGroup.sent_to?.entity_name === ChatParticipantType.Users) {
    return { entity_name: messageGroup.sent_to.entity_name, meta: { user_name: 'User No Longer Available' } };
  }
  return undefined;
}

/**
 * apps/elitea-ui/src/common/convertChatConversationMessages.js:35-82
 * `convertToUserQuestion`, ported. `createdAt` is the ISO string
 * `convertTime` already produces (`MessageBase.createdAt: string`) rather
 * than the source's `new Date(...).getTime()` epoch number — this entity's
 * declared shape wants a string, and `convertTime` above is exactly that
 * conversion. Unlike `convertToAIAnswer`, the source never defaults or
 * sorts `message_items` here, so `messageItems` is passed through as-is.
 */
type UserOptionalFields = Partial<
  Pick<UserMessage, 'messageItems' | 'userId' | 'participantId' | 'sentTo' | 'likes' | 'interactionUuid'>
>;

/** The 6 optional `UserMessage` fields, split out to stay under the complexity budget. */
function userOptionalFields(
  messageGroup: MessageGroupWire,
  foundUser: MessageAuthorWire | undefined,
  sentTo: unknown,
): UserOptionalFields {
  return {
    ...(messageGroup.message_items !== undefined ? { messageItems: messageGroup.message_items } : {}),
    ...(foundUser?.entity_meta?.id !== undefined ? { userId: String(foundUser.entity_meta.id) } : {}),
    ...(messageGroup.sent_to_id !== undefined ? { participantId: String(messageGroup.sent_to_id) } : {}),
    ...(sentTo !== undefined ? { sentTo } : {}),
    ...(messageGroup.likes !== undefined ? { likes: messageGroup.likes } : {}),
    ...(messageGroup.meta?.interaction_uuid !== undefined
      ? { interactionUuid: messageGroup.meta.interaction_uuid }
      : {}),
  };
}

export function normaliseUserMessage(
  messageGroup: MessageGroupWire,
  users: readonly MessageAuthorWire[],
  participants: readonly MessageParticipantWire[],
): UserMessage {
  const statesAnAuthor = messageGroup.author_participant_id !== undefined && messageGroup.author_participant_id !== '';
  // String-normalised: the Go transcript endpoint states the id as a number
  // and the Go participants payload does too, but socket-era payloads carried
  // strings — a strict === across the two spellings silently resolves no
  // author, which reads as "User No Longer Available".
  const foundUser = users.find((user) => String(user.id) === String(messageGroup.author_participant_id));
  const foundParticipant = participants.find((participant) => participant.id === messageGroup.sent_to_id);
  const sentTo = resolveSentTo(messageGroup, foundParticipant);

  return {
    id: messageGroup.uuid,
    role: ROLES.User,
    name: getMessageAuthorName(foundUser, statesAnAuthor),
    avatar: foundUser?.meta?.user_avatar || '',
    content: messageGroup.content,
    createdAt: convertTime(messageGroup.created_at),
    ...userOptionalFields(messageGroup, foundUser, sentTo),
  };
}

// ── convertToAIAnswer (lines 111-313) ──────────────────────────────────────

/** `foundQuestion` lookup + `question_id` resolution (lines 127, 295). */
function resolveQuestionId(messageGroup: MessageGroupWire, messageGroups: readonly MessageGroupWire[]): string | undefined {
  const foundQuestion = messageGroups.find(
    (item) => item.id === messageGroup.reply_to_id || messageGroup.question_id === item.id,
  );
  if (!foundQuestion) return undefined;
  return foundQuestion.uuid || String(foundQuestion.id);
}

/**
 * `replyToId`/`questionId`/`taskId` (lines 118, 124-127, 295, 304). The
 * source never returns `reply_to_id` directly (it only uses it internally
 * to resolve `question_id`), but it is a real field within the cited range
 * and `AssistantMessage.replyToId` has no other evidenced source, so it is
 * populated from the raw FK, stringified.
 */
function assistantLinkageFields(
  messageGroup: MessageGroupWire,
  messageGroups: readonly MessageGroupWire[],
): Partial<Pick<AssistantMessage, 'replyToId' | 'questionId' | 'taskId'>> {
  const questionId = resolveQuestionId(messageGroup, messageGroups);
  return {
    ...(messageGroup.reply_to_id !== undefined ? { replyToId: String(messageGroup.reply_to_id) } : {}),
    ...(questionId !== undefined ? { questionId } : {}),
    ...(messageGroup.task_id !== undefined ? { taskId: messageGroup.task_id } : {}),
  };
}

/** `isStreaming`/`isLoading` (lines 297-298) — both mirror `is_streaming`. */
function assistantStreamingFields(
  messageGroup: MessageGroupWire,
): Partial<Pick<AssistantMessage, 'isStreaming' | 'isLoading'>> {
  return messageGroup.is_streaming !== undefined
    ? { isStreaming: messageGroup.is_streaming, isLoading: messageGroup.is_streaming }
    : {};
}

/** chat.helpers.js:88-105 `buildHitlInterruptFromRaw`, first half of its fields. */
function hitlInterruptCoreFields(raw: HitlInterruptRawWire): Record<string, unknown> {
  return {
    message: raw.message || 'Please review and take action.',
    node_name: raw.node_name || '',
    available_actions: raw.available_actions || ['approve', 'reject'],
    routes: raw.routes || {},
    edit_state_key: raw.edit_state_key || '',
    guardrail_type: raw.guardrail_type || '',
    tool_name: raw.tool_name || '',
    toolkit_name: raw.toolkit_name || '',
  };
}

/** chat.helpers.js:88-105 `buildHitlInterruptFromRaw`, ported (remaining fields — split for complexity). */
function buildHitlInterruptFromRaw(raw: HitlInterruptRawWire): Record<string, unknown> {
  return {
    ...hitlInterruptCoreFields(raw),
    toolkit_type: raw.toolkit_type || '',
    action_label: raw.action_label || '',
    tool_args: raw.tool_args ?? null,
    policy_message: raw.policy_message || '',
    tool_call_id: raw.tool_call_id || '',
    child_thread_id: raw.child_thread_id || '',
    parent_agent_name: raw.parent_agent_name || '',
    thread_id: raw.thread_id || '',
  };
}

/** HITL resume-state reconstruction (lines 271-285) — #4823. */
function assistantHitlFields(
  meta: MessageGroupWire['meta'],
): Partial<Pick<AssistantMessage, 'hitlInterrupt' | 'hitlInterrupts' | 'threadId'>> {
  const rawInterrupts = meta?.hitl_interrupts;
  const hitlInterrupts =
    Array.isArray(rawInterrupts) && rawInterrupts.length > 0
      ? rawInterrupts.map(buildHitlInterruptFromRaw)
      : undefined;
  const hitlInterrupt = meta?.hitl_interrupt ? buildHitlInterruptFromRaw(meta.hitl_interrupt) : hitlInterrupts?.[0];
  return {
    ...(hitlInterrupt !== undefined ? { hitlInterrupt } : {}),
    ...(hitlInterrupts !== undefined ? { hitlInterrupts } : {}),
    ...(meta?.thread_id !== undefined ? { threadId: meta.thread_id } : {}),
  };
}

function assistantContinuationFields(
  meta: MessageGroupWire['meta'],
): Partial<Pick<AssistantMessage, 'requiresConfirmation'>> {
  if (meta?.output_limit_reached !== true) return {};
  return {
    requiresConfirmation: {
      message: "Token limit reached mid-response. Press 'Continue' to see more.",
      buttonText: 'Continue',
    },
  };
}

/** `meta.thinking_steps`/`meta.tool_calls`/`meta.first_tool_timestamp_start` — `buildToolActions`' raw inputs. */
function resolveAssistantToolInputs(meta: MessageGroupWire['meta']) {
  return {
    thinkingSteps: meta?.thinking_steps ?? [],
    toolCalls: meta?.tool_calls ?? {},
    firstToolTimestampStart: meta?.first_tool_timestamp_start,
  };
}

/** `is_error`/`isSummarized`/`references` (lines 133-140). */
function resolveAssistantSummaryFields(meta: MessageGroupWire['meta']) {
  return {
    isError: meta?.is_error ?? false,
    isSummarized: meta?.context?.included === false,
    references: meta?.references ?? [],
  };
}

/** `exception` (line 299). */
function resolveException(
  messageGroup: MessageGroupWire,
  meta: MessageGroupWire['meta'],
  isError: boolean,
  messageItems: readonly MessageItemWire[],
): unknown {
  if (!isError) return undefined;
  return meta?.error || messageGroup.content || messageItems[0]?.item_details?.content;
}

/**
 * apps/elitea-ui/src/common/convertChatConversationMessages.js:111-313
 * `convertToAIAnswer`, ported. `createdAt`/`updatedAt` are kept as TWO
 * distinct ISO strings (both via `convertTime`) rather than the source's
 * single collapsed `displayTime = updated_at || created_at` — this
 * entity's shape carries both raw timestamps separately (unlike the old
 * UI's single-timestamp render model) and leaves "which one to show" to
 * the consuming UI. `interaction_uuid`/`participant_id`/`originalId`/the
 * full `replyTo` object the source also returns have no corresponding
 * `AssistantMessage` field and are intentionally dropped. Not ported:
 * `convertToPlayerQuestion` (a distinct function, out of scope) and
 * `convertMessagesToChatHistory`'s list-level concerns (chronological
 * sort, parent/child-row split, swarm-child `toolActions` attachment,
 * lines 315-387) — those act over the WHOLE conversation, not one
 * `message_group`, and belong to a Wave-2 feature, not this entity-level
 * normaliser.
 */
export function normaliseAssistantMessage(
  messageGroup: MessageGroupWire,
  messageGroups: readonly MessageGroupWire[],
  participants: readonly MessageParticipantWire[] | undefined,
): AssistantMessage {
  const messageItems = messageGroup.message_items ?? [];
  const meta = messageGroup.meta;
  const { isError, isSummarized, references } = resolveAssistantSummaryFields(meta);
  const { thinkingSteps, toolCalls, firstToolTimestampStart } = resolveAssistantToolInputs(meta);
  const foundParticipant = participants?.find((participant) => participant.id === messageGroup.author_participant_id);

  const toolActions = buildToolActions(
    thinkingSteps,
    toolCalls,
    convertTime(messageGroup.created_at),
    firstToolTimestampStart,
    foundParticipant,
  );
  const exception = resolveException(messageGroup, meta, isError, messageItems);

  return {
    id: messageGroup.uuid,
    role: ROLES.Assistant,
    content: messageGroup.is_streaming ? '...' : messageGroup.content,
    messageItems: [...messageItems].sort((a, b) => a.id - b.id),
    createdAt: convertTime(messageGroup.created_at),
    isSummarized,
    references,
    toolActions,
    ...assistantLinkageFields(messageGroup, messageGroups),
    ...(messageGroup.updated_at !== undefined ? { updatedAt: convertTime(messageGroup.updated_at) } : {}),
    ...assistantStreamingFields(messageGroup),
    ...(exception !== undefined ? { exception } : {}),
    ...(messageGroup.likes !== undefined ? { likes: messageGroup.likes } : {}),
    ...assistantHitlFields(meta),
    ...assistantContinuationFields(meta),
  };
}
