/**
 * Local port of `apps/elitea-ui/src/common/convertChatConversationMessages.js`'s
 * top-level orchestrator (`convertMessagesToChatHistory`/
 * `convertConversationToChatHistory`, lines 315-390) — sorts a
 * conversation's `message_groups`, partitions user vs. assistant rows, and
 * (for assistant rows) attaches any swarm sub-agent child messages as
 * `SwarmChild` tool actions.
 *
 * Reuses the REAL, already-ported per-item normalizers from
 * `entities/message` (`normaliseUserMessage`/`normaliseAssistantMessage`,
 * ported from the same file's `convertToUserQuestion`/`convertToAIAnswer`,
 * lines 35-313) rather than re-deriving them — only the orchestration
 * (sort/partition/swarm-attach) that entities/message does NOT export is
 * duplicated here.
 *
 * No promoted home exists for the orchestrator itself: it is not
 * indexes-specific (agents/pipelines run-history views need the identical
 * function), but it is not part of `entities/message`'s curated public API
 * either (confirmed via that slice's `index.ts`) and is not named as an
 * A4a dependency in this unit's brief. Same class of decision as
 * `useSelectedProjectId.ts`'s local duplicate.
 *
 * DISCLOSED SCOPE CUT: the baseline's `playerInfo` parameter (a session-
 * playback/"replay as another user" mode, dispatching to
 * `convertToPlayerQuestion` instead of `convertToUserQuestion`) is dropped.
 * The index test-chat panel this feeds (`useIndexHistory.hooks.ts`) never
 * has a playback session — confirmed: no `playerInfo`-shaped value exists
 * anywhere in this sub-unit's owned files or in `IndexChat.tsx`'s props.
 */
import { ChatParticipantType, TOOL_ACTION_TYPES, ToolActionStatus } from '@/shared/lib/chat';
import { normaliseAssistantMessage, normaliseUserMessage } from '@/entities/message';
import type { AssistantMessage, Message, MessageGroupWire, ToolAction } from '@/entities/message';

/** `message_group.meta`'s swarm-child fields — not part of `MessageGroupWire`'s typed `meta` (that type covers the thinking/tool-call shape `entities/message` itself reads, not this orchestration-only pair). */
interface SwarmChildMeta {
  /** Baseline reads this as `true` or the string `'true'` (`is_child_agent === true || is_child_agent === 'true'`) — `string` alone already covers the `'true'` case, `boolean` covers the `true` case. */
  readonly is_child_agent?: boolean | string;
  readonly parent_message_id?: string;
  readonly child_agent_name?: string;
}

/** `entities/message`'s `MessageItemWire` is deliberately narrow (only what its own normalizers read: `id`/`item_details.content`) — the swarm-child text extraction below additionally needs `item_type` (baseline: `item.item_type === 'text_message'`), which is real API-response shape, not invented. */
interface ConversationMessageItemWire {
  readonly id: number;
  readonly item_type?: string;
  readonly item_details?: { readonly content?: string };
}

/**
 * `entities/message`'s `MessageAuthorWire`/`MessageParticipantWire` are two
 * deliberately narrow VIEWS of the same underlying object (its own doc
 * comment: both come from the wire's `participants` array) — this
 * orchestrator needs the union of both PLUS `entity_name` (baseline:
 * `participant.entity_name === ChatParticipantType.Users`, the actual
 * user/participant discriminant), which neither narrow view carries. A
 * `ConversationParticipantWire` object (superset of both) is passed
 * everywhere `entities/message`'s narrower parameter types are expected —
 * structurally compatible (extra fields on a variable, not a literal, are
 * never an error).
 */
export interface ConversationParticipantWire {
  readonly id: string;
  readonly entity_name?: string;
  readonly meta?: { readonly user_name?: string; readonly user_avatar?: string; readonly tools?: readonly { readonly name?: string; readonly toolkit_name?: string; readonly type?: string }[] };
  readonly entity_meta?: { readonly email?: string; readonly id?: string };
}

type MessageGroupWithSwarmMeta = Omit<MessageGroupWire, 'message_items'> & {
  readonly meta?: MessageGroupWire['meta'] & SwarmChildMeta;
  readonly message_items?: readonly ConversationMessageItemWire[];
};

function isUserMessage(
  authorParticipantId: string | number | undefined,
  sentToId: string | number | undefined,
  userIds: readonly (string | number | undefined)[],
  replyToId: string | number | undefined,
  sentTo: unknown,
): boolean {
  return (
    userIds.includes(authorParticipantId) ||
    userIds.includes(sentToId) ||
    (!sentToId && !replyToId) ||
    Boolean(sentTo)
  );
}

function isChildAgentGroup(messageGroup: MessageGroupWithSwarmMeta): boolean {
  const flag = messageGroup.meta?.is_child_agent;
  return flag === true || flag === 'true';
}

function buildSwarmChildAction(child: MessageGroupWithSwarmMeta): ToolAction {
  const textItem = child.message_items?.find((item) => item.item_type === 'text_message');
  const content = textItem?.item_details?.content ?? child.content ?? '';
  const agentName = child.meta?.child_agent_name ?? 'Child Agent';

  return {
    id: child.uuid,
    name: agentName,
    type: TOOL_ACTION_TYPES.SwarmChild,
    status: ToolActionStatus.complete,
    content,
    toolInputs: '',
    toolOutputs: content,
    created_at: child.created_at,
    ended_at: child.created_at,
    timestamp: child.created_at,
    isSwarmChild: true,
    agentName,
  };
}

/** Port of `convertMessagesToChatHistory` (no `playerInfo` — see file header). */
function convertMessagesToChatHistory(
  messageGroups: readonly MessageGroupWithSwarmMeta[] = [],
  participants: readonly ConversationParticipantWire[] = [],
): Message[] {
  const sortedMessages = [...messageGroups].sort((a, b) => a.created_at.toLowerCase().localeCompare(b.created_at.toLowerCase()));
  const users = participants.filter((participant) => participant.entity_name === ChatParticipantType.Users);
  const userIds = users.map((user) => user.id);

  const childMessagesByParent = new Map<string, MessageGroupWithSwarmMeta[]>();
  const parentMessages: MessageGroupWithSwarmMeta[] = [];

  for (const messageGroup of sortedMessages) {
    const parentMessageId = messageGroup.meta?.parent_message_id;
    if (isChildAgentGroup(messageGroup) && parentMessageId) {
      const existing = childMessagesByParent.get(parentMessageId) ?? [];
      existing.push(messageGroup);
      childMessagesByParent.set(parentMessageId, existing);
    } else {
      parentMessages.push(messageGroup);
    }
  }

  return parentMessages.map((messageGroup) => {
    const { author_participant_id, sent_to_id, reply_to_id, sent_to, uuid } = messageGroup;
    const isUser = isUserMessage(author_participant_id, sent_to_id, userIds, reply_to_id, sent_to);

    if (isUser) {
      return normaliseUserMessage(messageGroup, users, participants);
    }

    const aiMessage: AssistantMessage = normaliseAssistantMessage(messageGroup, sortedMessages, participants);

    const childMessages = childMessagesByParent.get(uuid) ?? [];
    if (childMessages.length > 0) {
      const swarmChildActions = childMessages.map(buildSwarmChildAction);
      return { ...aiMessage, toolActions: [...swarmChildActions, ...(aiMessage.toolActions ?? [])] };
    }

    return aiMessage;
  });
}

interface ConversationDetailsLike {
  readonly message_groups?: readonly MessageGroupWithSwarmMeta[];
  readonly participants?: readonly ConversationParticipantWire[];
}

/** Port of `convertConversationToChatHistory`. */
export function convertConversationToChatHistory(conversationDetails: ConversationDetailsLike = {}): Message[] {
  const { message_groups = [], participants = [] } = conversationDetails;
  return convertMessagesToChatHistory(message_groups, participants);
}
