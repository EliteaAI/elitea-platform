/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/
 * chat.helpers.js` (unit C1). All ten exports are pure functions operating
 * on the RAW wire shapes in `./wire.ts` — no React, no network.
 *
 * `getWelcomeMessage`/`getInitialChatHistory` are the CANONICAL port (the
 * baseline file's own lines 7-22). `features/agents/lib/hooks/
 * applicationChat.helpers.ts` already carries a duplicate of both — that
 * file's own doc comment already discloses its copy as non-canonical
 * ("Duplicated locally, NOT imported from `features/chat`: that slice does
 * not exist in this app yet"), so this landing here is the expected
 * resolution, not a new conflict; that sibling file is out of this unit's
 * ownership fence and is left as-is.
 *
 * `DEFAULT_MAX_TOKENS`/`DEFAULT_TEMPERATURE`
 * (`[fsd]/shared/lib/constants/llmSettings.constants.js:7-8`, values `-1`/
 * `0.6`) have not been ported to this app's `shared/lib/**` yet (grepped,
 * zero hits) — same real, disclosed gap `features/toolkits/lib/helpers/
 * toolkitConversation.helpers.ts` already flagged; kept as local literals
 * with their exact baseline values here too, rather than invented, rounded,
 * or imported from that unrelated feature slice (which entities/ may not
 * import anyway).
 */
import { ROLES, WELCOME_MESSAGE_ID } from '@/shared/lib/enums';
import { ChatParticipantType } from '@/shared/lib/chat';

import { getChatUserSettings } from './newConversation.helpers';
import type {
  AvailableModelWire,
  ChatHistoryEntryWire,
  ChatParticipantWire,
  ConversationForHelpers,
  HitlInterruptRawWire,
  ToolActionMetadataWire,
} from './wire';

/** `[fsd]/shared/lib/constants/llmSettings.constants.js:7-8` — not yet ported to `shared/lib/**`; kept local until it is (see module doc). */
const DEFAULT_MAX_TOKENS = -1;
const DEFAULT_TEMPERATURE = 0.6;

/** A chat-history row shaped like `getWelcomeMessage`'s own return value. */
export interface WelcomeMessage {
  readonly id: string;
  readonly role: 'assistant';
  readonly content: string;
  readonly isLoading: false;
  readonly isStreaming: false;
  readonly created_at: number;
  readonly participant_id?: string | number;
}

/** `chat.helpers.js:7-15`. */
export function getWelcomeMessage(welcomeMessage: string, participantId?: string | number | null): WelcomeMessage {
  return {
    id: WELCOME_MESSAGE_ID,
    role: ROLES.Assistant,
    content: welcomeMessage,
    isLoading: false,
    isStreaming: false,
    created_at: new Date().getTime(),
    ...(participantId ? { participant_id: participantId } : {}),
  };
}

/** `chat.helpers.js:17-22`. */
export function getInitialChatHistory(welcomeMessage: string | undefined, participantId?: string | number | null): WelcomeMessage[] {
  return welcomeMessage ? [getWelcomeMessage(welcomeMessage, participantId)] : [];
}

/** `chat.helpers.js:24-44`. Byte-for-byte port, including the "less than a second" / singular-"1 sec" branching. */
export function calculateDuration(startTime: string | number | undefined, endTime: string | number | undefined): string {
  // `?? NaN` (not `?? undefined`, which has no valid `Date` constructor overload):
  // `new Date(NaN)` is an Invalid Date, matching the baseline's own
  // `new Date(startTime ?? undefined)` outcome for a missing timestamp.
  const start = new Date(startTime ?? NaN);
  const end = new Date(endTime ?? NaN);
  const durationMs = end.getTime() - start.getTime();

  const seconds = Math.floor((durationMs / 1000) % 60);
  const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
  const hours = Math.floor(durationMs / (1000 * 60 * 60));

  if (hours) return `${hours} h ${minutes} min and ${seconds} sec`;
  if (minutes) return `${minutes} min and ${seconds} sec`;
  if (seconds > 1) return `${seconds} secs`;
  return seconds > 0 ? '1 sec' : 'less than a second';
}

const EMPTY_PARTICIPANT: ChatParticipantWire = { entity_meta: {}, meta: {} };

/** `chat.helpers.js:46-50`. */
export function getParticipantById(conversation: ConversationForHelpers | undefined, participantId: string | undefined): ChatParticipantWire {
  return conversation?.participants?.find(({ id }) => id !== undefined && id === participantId) ?? EMPTY_PARTICIPANT;
}

/** `chat.helpers.js:52-56`. */
export function canDeleteThisAIMessage(chatHistory: readonly ChatHistoryEntryWire[], message: ChatHistoryEntryWire, userId: string | undefined): boolean {
  const foundQuestion = chatHistory.find((item) => item.id === message.question_id);
  return foundQuestion?.user_id === userId;
}

/** `chat.helpers.js:58-71`. */
export function getToolActionOriginalName(metadata: ToolActionMetadataWire | undefined): string | null {
  if (metadata?.toolkit_type === 'internal') return null;
  if (metadata?.original_name) return metadata.original_name;
  const ns = metadata?.checkpoint_ns;
  if (!ns) return null;
  const name = ns.split(':')[0];
  return name && name !== 'main_agent' && name !== 'agent' ? name : null;
}

/** UI-shaped HITL interrupt — `chat.helpers.js:88-105`'s return-value shape. */
export interface HitlInterruptUi {
  readonly message: string;
  readonly node_name: string;
  readonly available_actions: readonly string[];
  readonly routes: unknown;
  readonly edit_state_key: string;
  readonly guardrail_type: string;
  readonly tool_name: string;
  readonly toolkit_name: string;
  readonly toolkit_type: string;
  readonly action_label: string;
  readonly tool_args: unknown;
  readonly policy_message: string;
  readonly tool_call_id: string;
  readonly child_thread_id: string;
  readonly parent_agent_name: string;
  readonly thread_id: string;
}

/** Falsy-coalesce. */
function orFalsy<T>(value: T | undefined, fallback: T): T {
  return value || fallback;
}

const EMPTY_RAW: HitlInterruptRawWire = {};

/**
 * `chat.helpers.js:73-105`. The single `raw ?? EMPTY_RAW` up front (instead
 * of a `raw?.field` optional-chain per field) is what keeps this function's
 * own cyclomatic count under the §3.5 budget — oxlint's `complexity` rule
 * counts EVERY `?.`/`??` as a branch, and 16 fields each carrying their own
 * `raw?.` chain measured at 18 (`orFalsy`'s single `||` does not add a
 * per-call branch to the CALLER, only to `orFalsy` itself, which is
 * independently well under budget).
 */
export function buildHitlInterruptFromRaw(raw: HitlInterruptRawWire | undefined): HitlInterruptUi {
  const source = raw ?? EMPTY_RAW;
  return {
    message: orFalsy(source.message, 'Please review and take action.'),
    node_name: orFalsy(source.node_name, ''),
    available_actions: orFalsy(source.available_actions, ['approve', 'reject']),
    routes: orFalsy(source.routes, {}),
    edit_state_key: orFalsy(source.edit_state_key, ''),
    guardrail_type: orFalsy(source.guardrail_type, ''),
    tool_name: orFalsy(source.tool_name, ''),
    toolkit_name: orFalsy(source.toolkit_name, ''),
    toolkit_type: orFalsy(source.toolkit_type, ''),
    action_label: orFalsy(source.action_label, ''),
    tool_args: source.tool_args ?? null,
    policy_message: orFalsy(source.policy_message, ''),
    tool_call_id: orFalsy(source.tool_call_id, ''),
    child_thread_id: orFalsy(source.child_thread_id, ''),
    parent_agent_name: orFalsy(source.parent_agent_name, ''),
    thread_id: orFalsy(source.thread_id, ''),
  };
}

export interface CreateHitlEditUserMessageParams {
  readonly question: string;
  readonly participant?: ChatParticipantWire;
  readonly userId?: string;
  readonly name?: string;
  readonly avatar?: string;
}

/** `chat.helpers.js:107-138`. `crypto.randomUUID()` replaces the baseline's `uuidv4()` — same substitute this codebase already uses elsewhere (no `uuid` package dependency). */
export function createHitlEditUserMessage(params: CreateHitlEditUserMessageParams): Readonly<Record<string, unknown>> {
  const { question, participant, userId, name, avatar } = params;
  const messageId = crypto.randomUUID();
  const itemId = new Date().getTime();

  return {
    id: messageId,
    role: ROLES.User,
    name,
    avatar,
    content: question,
    created_at: new Date().getTime(),
    user_id: userId,
    participant_id: participant?.id,
    sentTo: participant ?? {},
    message_items: [
      {
        id: itemId,
        uuid: messageId,
        meta: {},
        order_index: 0,
        item_type: 'text_message',
        item_details: { content: question, id: itemId, item_type: 'text_message' },
      },
    ],
  };
}

/** `chat.helpers.js:147-161`. `getChatUserSettings` (`./newConversation.helpers.ts`) supplies the intermediate `userSettings` lookup — same intra-slice call the baseline makes (`NewConversationHelpers.getChatUserSettings`, imported cross-file within the same old-app feature). */
export function getSelectedConversationModel(
  conversation: ConversationForHelpers | undefined,
  availableModels: readonly AvailableModelWire[] | undefined,
  userId: string | undefined,
): AvailableModelWire | null {
  const userSettings = getChatUserSettings(conversation, userId);
  const modelName = userSettings?.model_name as string | undefined;
  if (!modelName || !availableModels?.length) return null;

  const modelProjectId = userSettings?.model_project_id as string | number | undefined;
  const exact = availableModels.find((m) => m.name === modelName && m.project_id === modelProjectId);
  return exact ?? availableModels.find((m) => m.name === modelName) ?? null;
}

export interface ModelSettings {
  readonly max_tokens?: unknown;
  readonly temperature?: unknown;
  readonly model_name?: unknown;
  readonly model_project_id?: unknown;
  readonly reasoning_effort?: unknown;
}

/** `chat.helpers.js:163-186`. */
export function getModelSettings(participant: ChatParticipantWire): ModelSettings {
  if (participant.entity_name !== ChatParticipantType.Applications) return {};

  const llmSettings = participant.entity_settings?.llm_settings ?? {};
  const {
    max_tokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    reasoning_effort,
    model_project_id,
    model_name,
  } = llmSettings as {
    readonly max_tokens?: unknown;
    readonly temperature?: unknown;
    readonly reasoning_effort?: unknown;
    readonly model_project_id?: unknown;
    readonly model_name?: unknown;
  };

  return {
    max_tokens,
    temperature,
    model_name,
    model_project_id,
    ...(reasoning_effort !== undefined ? { reasoning_effort } : {}),
  };
}
