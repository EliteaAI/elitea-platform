import type { Participant } from '@/entities/participant';

import type { UsePipelineAttachmentsResult } from './usePipelineAttachments';

/**
 * Shared types for `usePipelineChat` and its sub-hooks
 * (`usePipelineChatConversation.hooks.ts`, `usePipelineChatMessaging.hooks.ts`,
 * `usePipelineChatStreaming.hooks.ts`, `usePipelineChatSockets.hooks.ts`) —
 * split out of `usePipelineChat.hooks.ts` purely to keep every file under
 * this codebase's `max-lines`/`complexity` gates, matching
 * `features/agents/lib/hooks/applicationChat.types.ts`'s own identical
 * split rationale for the sibling baseline file this one mirrors
 * (`useApplicationChat.hooks.js`/`usePipelineChat.hooks.js` are, per this
 * mission's own preamble, near-duplicate "create/validate/save an
 * Application" chat orchestration — a Pipeline is literally an Application
 * row).
 */

export type ChatSource = 'agent' | 'pipeline';

/** Loose, client-owned chat-history row shape — no wire schema exists for it (real backend gap, see `usePipelineChat.hooks.ts`'s module doc comment). */
export interface ChatHistoryMessage {
  readonly id: string | number;
  readonly role: string;
  content?: unknown;
  isLoading?: boolean | undefined;
  isStreaming?: boolean | undefined;
  isRegenerating?: boolean | undefined;
  task_id?: string | undefined;
  participant_id?: string | number | undefined;
  question_id?: string | undefined;
  created_at?: number | undefined;
  [key: string]: unknown;
}

export interface ChatConversation {
  id?: string | number | undefined;
  uuid?: string | undefined;
  name?: string | undefined;
  is_private?: boolean | undefined;
  source?: ChatSource | undefined;
  participants?: readonly Participant[] | undefined;
  chat_history: ChatHistoryMessage[];
  isNew?: boolean | undefined;
  isPipelineChat?: boolean | undefined;
  /** Read by `ChatPanel.tsx`'s `renderContextBudget` slot props (baseline: `ChatPanel.jsx`'s `activeConversation?.meta?.context_strategy`). */
  meta?: { readonly context_strategy?: Readonly<Record<string, unknown>> } | undefined;
  /** Read by `ChatPanel.tsx`'s `renderContextBudget` slot props (baseline: `ChatPanel.jsx`'s `activeConversation?.instructions`). */
  instructions?: unknown;
}

export interface ChatPipelineVersionDetails {
  readonly id?: string | number;
  readonly description?: string;
  readonly welcome_message?: string;
  readonly variables?: readonly unknown[];
  readonly instructions?: string;
  readonly tools?: readonly unknown[];
  readonly agent_type?: string;
  /** The chat participant type (baseline `version_details.type`, defaults to `'chat'`) — a different field from `agent_type`. Read by `ConfigurationTab.tsx`'s own `settings.type`. */
  readonly type?: string;
  /** Read by `ConfigurationTab.tsx`'s own `settings.conversationStarters`. */
  readonly conversation_starters?: readonly unknown[];
  readonly meta?: { readonly icon_meta?: unknown; readonly internal_tools?: readonly string[] };
  readonly llm_settings?: {
    readonly model_name?: string;
    readonly model_project_id?: string | number;
    readonly max_tokens?: number;
    readonly temperature?: number;
    readonly reasoning_effort?: string;
    readonly [key: string]: unknown;
  };
}

interface CreateConversationAdapterInput {
  readonly is_private: true;
  readonly name: string;
  readonly source: ChatSource;
  readonly meta: { readonly single_participant: Participant; readonly internal_tools: readonly string[] | undefined };
  readonly participants: readonly Participant[];
  readonly projectId: string | undefined;
}

export interface CreateConversationAdapterResult {
  readonly data?: ChatConversation & { readonly id: string | number; readonly uuid: string };
  readonly error?: unknown;
}

/**
 * The 3 data operations `usePipelineChat` needs and no generated endpoint
 * yet backs. **REAL, VERIFIED BACKEND GAP:** grepping this app's entire
 * generated client (`shared/api/generated/**`) for "conversation" finds
 * zero REST operations beyond `useWebchatSync`/`useGetChatConfig`
 * (`chat/chat.ts`) — no create, no details-by-id, no message delete, no
 * stop-task (same gap `features/agents/lib/hooks/useApplicationChat.hooks.ts`
 * already documents for the identical baseline situation). Rather than
 * invent endpoints or silently no-op, this hook takes an injected adapter —
 * a future chat-domain unit supplies the real implementation once these
 * endpoints exist.
 */
export interface ChatConversationAdapter {
  readonly createConversation: (input: CreateConversationAdapterInput) => Promise<CreateConversationAdapterResult>;
  readonly deleteMessage: (input: {
    readonly conversationId: string | number | undefined;
    readonly projectId: string | undefined;
    readonly id: string | number;
  }) => Promise<{ readonly error?: unknown }>;
  readonly deleteAllMessages: (input: {
    readonly conversationId: string | number | undefined;
    readonly projectId: string | undefined;
  }) => Promise<{ readonly error?: unknown }>;
  readonly stopChatTask: (input: {
    readonly projectId: string | undefined;
    readonly messageGroupUuid: string | number;
  }) => Promise<void>;
}

export interface UsePipelineChatParams {
  readonly pipelineId: string | number | undefined;
  readonly pipelineName: string | undefined;
  readonly pipelineVersionDetails: ChatPipelineVersionDetails | undefined;
  readonly projectId: string | undefined;
  readonly setFieldValue: (field: string, value: unknown) => void;
  /** Caller-fetched, not fetched by this hook (same adapter-gap reasoning as `createConversation`). */
  readonly restoredConversationID?: string | number | null;
  readonly restoredConversationData?: ChatConversation | undefined;
  readonly isLoadingRestoredConversation?: boolean;
  readonly isErrorRestoredConversation?: boolean;
  readonly onRestoreConversationComplete: () => void;
  readonly adapter: ChatConversationAdapter;
  readonly deleteAllRunNodes?: (() => void) | undefined;
  /**
   * Optional injected callback for a remote `chat_message_sync` event's raw
   * payload. **DISCLOSED GAP, same as `useApplicationChat.hooks.ts`'s own
   * deviation 8:** the baseline's `useSynAgentChatMessage` (confirmed
   * NOT-PROMOTED, "duplicate locally" per this mission's preamble) depends
   * on `convertToAIAnswer` (`common/convertChatConversationMessages.js:111-
   * 313`, ~200 lines), which itself depends on
   * `collapseSubAgentInvocationKeys` (`features/chat`, not owned by this
   * sub-unit, not promoted, and that slice does not exist anywhere in this
   * app yet). Porting that whole chain here would duplicate the same
   * chat-domain merge logic `entities/message/lib/normalise.ts`'s own doc
   * comment already scopes OUT of the entity layer as "a Wave-2 feature['s]"
   * concern. This hook wires the `chat_message_sync` subscription itself
   * (real, not a slot) and hands the raw payload to whatever the caller
   * supplies — real merge logic once a chat-domain unit exists to own it.
   */
  readonly onRemoteChatMessageSync?: (messageGroup: Readonly<Record<string, unknown>>) => void;
  /** Presentational feedback the baseline sourced from `useToast()` — no toast/snackbar primitive exists yet in this app. */
  readonly onInfo?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

export interface UsePipelineChatResult {
  readonly activeConversation: ChatConversation | null;
  readonly activeParticipant: Participant | null;
  readonly isCreatingConversation: boolean;
  readonly isStreaming: boolean;
  readonly isLoadingConversation: boolean;
  readonly setChatHistory: (
    update: ChatHistoryMessage[] | ((prev: ChatHistoryMessage[]) => ChatHistoryMessage[]),
  ) => void;
  readonly setActiveConversation: (
    update: ChatConversation | null | ((prev: ChatConversation | null) => ChatConversation | null),
  ) => void;
  readonly onDeleteMessage: (messageIdToDelete: string | number, callback?: () => void) => Promise<void>;
  readonly onDeleteAllMessages: (callback?: () => void) => Promise<void>;
  readonly onChangeParticipantSettings: (participantId: string | number, updates: Readonly<Record<string, unknown>>) => void;
  readonly onSetLLMSettings: (newSettings: Readonly<Record<string, unknown>>) => void;
  readonly onSend: (messageData: SendMessageData) => Promise<SendResult>;
  readonly onSelectThisParticipant: () => void;
  readonly onClearActiveParticipant: () => void;
  readonly onStopStreaming: (message: ChatHistoryMessage) => () => Promise<void>;
  readonly onStopAll: () => Promise<void>;
  readonly pipelineParticipant: Participant | null;
  readonly activeParticipantDetails: Readonly<Record<string, unknown>> | null;
  readonly disableAttachments: UsePipelineAttachmentsResult['disableAttachments'];
  readonly attachments: UsePipelineAttachmentsResult['attachments'];
  readonly onAttachFiles: UsePipelineAttachmentsResult['onAttachFiles'];
  readonly onDeleteAttachment: UsePipelineAttachmentsResult['onDeleteAttachment'];
  readonly onClearAttachments: UsePipelineAttachmentsResult['onClearAttachments'];
}

export interface SendMessageData {
  readonly needsConversationCreation?: boolean;
  readonly userInput?: string;
  readonly newMessages?: readonly ChatHistoryMessage[];
  readonly question_id?: string;
  readonly eventPayload?: {
    readonly llm_settings?: Readonly<Record<string, unknown>>;
    readonly attachments_info?: unknown;
    readonly mcp_tokens?: unknown;
    readonly ignored_mcp_servers?: unknown;
  };
}

export interface SendResult {
  readonly success: boolean;
  readonly updatedEventPayload?: Readonly<Record<string, unknown>>;
  readonly createdConversation?: ChatConversation;
  readonly activeParticipant?: Participant;
  readonly updatedMessages?: readonly ChatHistoryMessage[];
}
