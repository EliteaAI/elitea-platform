/**
 * Wire shapes read/produced by this cluster's REST layer (`../api/**`) and
 * the pure helpers ported from `chat.helpers.js`/`newConversation.helpers.js`
 * (`chat.helpers.ts`/`newConversation.helpers.ts`) — the RAW,
 * pre-normalisation participant/message/conversation payload the backend
 * actually returns, distinct from this slice's own normalised
 * `Conversation`/`ConversationParticipantRef` domain types (`model/types.ts`,
 * used by `model/selectors.ts` and `lib/normalise.ts`'s `createDraftConversation`).
 *
 * Declared locally rather than imported from `entities/participant`/
 * `entities/message` — those slices model the SAME real backend concepts,
 * but `no-sideways-entities` forbids one entity slice importing another (see
 * `model/types.ts`'s own doc comment for the identical constraint on this
 * slice's `ConversationParticipantRef`). A small amount of field-shape
 * duplication across the three entity slices is the accepted cost, same
 * class of disclosed duplication already established by `entities/message/
 * lib/wire.ts` (whose own header makes the identical trade-off) and
 * `features/toolkits/indexes/lib/helpers/conversationHistory.local.ts`'s
 * `ConversationParticipantWire`.
 */

/** A conversation participant as it appears on the wire — `entity_name`/`entity_meta`/`entity_settings`/`meta`, evidenced by `[fsd]/features/chat/api/chat.api.js` + `[fsd]/features/chat/lib/helpers/{chat,newConversation}.helpers.js`. */
export interface ChatParticipantWire {
  readonly id?: string;
  readonly entity_name?: string;
  /**
   * `id` is `string | number`: the backend stores it as a JSON number (the
   * legacy pydantic participant model declares `id: int`), while the app's
   * `userId` is a string. It was declared `string` alone, which hid a strict
   * `===` comparison that could never match. See `isSameUser` in
   * `./newConversation.helpers.ts`.
   */
  readonly entity_meta?: { readonly id?: string | number; readonly [key: string]: unknown };
  readonly entity_settings?: {
    readonly llm_settings?: Readonly<Record<string, unknown>>;
    readonly agent_type?: string;
    readonly [key: string]: unknown;
  };
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** The minimal conversation shape `chat.helpers.ts`/`newConversation.helpers.ts` read — just the `participants[]` array, not the full wire conversation (see `../api/conversationApi.ts`'s `ConversationDetailsWire` for that). */
export interface ConversationForHelpers {
  readonly participants?: readonly ChatParticipantWire[];
}

/** A `chat_history` row, narrowed to exactly the fields `canDeleteThisAIMessage` reads (`chat.helpers.js:52-56`). */
export interface ChatHistoryEntryWire {
  readonly id?: string | number;
  readonly question_id?: string | number;
  readonly user_id?: string;
}

/** A `chat_history` row, narrowed to exactly the fields `useChatStreaming.js`'s streaming-message search reads. */
export interface StreamingChatHistoryItem {
  readonly replyTo?: { readonly uuid?: string; readonly id?: string | number };
  readonly role?: string;
  readonly question_id?: string | number;
  readonly isStreaming?: boolean;
  readonly isLoading?: boolean;
  readonly isRegenerating?: boolean;
}

/** Raw persisted HITL interrupt dict (`chat.helpers.js:73-105`) — same field set as `entities/message/lib/wire.ts`'s `HitlInterruptRawWire`, duplicated locally per the module doc above. */
export interface HitlInterruptRawWire {
  readonly message?: string;
  readonly node_name?: string;
  readonly available_actions?: readonly string[];
  readonly routes?: unknown;
  readonly edit_state_key?: string;
  readonly guardrail_type?: string;
  readonly tool_name?: string;
  readonly toolkit_name?: string;
  readonly toolkit_type?: string;
  readonly action_label?: string;
  readonly tool_args?: unknown;
  readonly policy_message?: string;
  readonly tool_call_id?: string;
  readonly child_thread_id?: string;
  readonly parent_agent_name?: string;
  readonly thread_id?: string;
}

/** `metadata` argument of `getToolActionOriginalName` (`chat.helpers.js:62-71`). */
export interface ToolActionMetadataWire {
  readonly toolkit_type?: string;
  readonly original_name?: string;
  readonly checkpoint_ns?: string;
}

/** One entry of the `availableModels` list `getSelectedConversationModel` searches (`chat.helpers.js:147-161`). */
export interface AvailableModelWire {
  readonly name?: string;
  readonly project_id?: string | number;
}
