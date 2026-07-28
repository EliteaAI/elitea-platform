import type { Participant } from '@/entities/participant';
import type { UseAgentAttachmentsResult } from '../useAgentAttachments';

/**
 * Shared types for `useApplicationChat` and its sub-hooks
 * (`useApplicationChatConversation.hooks.ts`,
 * `useApplicationChatMessaging.hooks.ts`) — split out of
 * `useApplicationChat.hooks.ts` purely to keep every file under this
 * codebase's `max-lines`/`complexity` gates (see that file's own module doc
 * comment for the full baseline-file citation and disclosed-deviation
 * list; this split is a lint-budget mechanic, not a behavioural change).
 */

export type ChatSource = 'agent' | 'pipeline';

/** Loose, client-owned chat-history row shape — no wire schema exists for it (real backend gap, see `useApplicationChat.hooks.ts`'s module doc comment). Mirrors exactly the fields the baseline reads/writes on `chat_history[]` entries. */
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
  isApplicationChat?: boolean | undefined;
}

export interface ChatApplicationVersionDetails {
  readonly id?: string | number;
  readonly description?: string;
  readonly welcome_message?: string;
  readonly variables?: readonly unknown[];
  readonly instructions?: string;
  readonly tools?: readonly unknown[];
  readonly agent_type?: string;
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

export interface CreateConversationAdapterInput {
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
 * The 3 data operations `useApplicationChat` needs and no generated
 * endpoint yet backs — see `useApplicationChat.hooks.ts`'s module doc
 * comment for the full backend-gap citation. Every method mirrors the
 * baseline RTK Query mutation it replaces.
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

export interface UseApplicationChatParams {
  readonly applicationId: string | number | undefined;
  readonly applicationName: string | undefined;
  readonly applicationVersionDetails: ChatApplicationVersionDetails | undefined;
  readonly projectId: string | undefined;
  readonly setFieldValue: (field: string, value: unknown) => void;
  /** `'agent'` (default) or `'pipeline'` — the baseline auto-detected this via the current route; see `useApplicationChat.hooks.ts`'s module doc comment, deviation 2. */
  readonly source?: ChatSource;
  /** Caller-fetched, not fetched by this hook — see module doc comment, deviation 1. */
  readonly restoredConversationID?: string | number | null;
  readonly restoredConversationData?: ChatConversation | undefined;
  readonly isLoadingRestoredConversation?: boolean;
  readonly isErrorRestoredConversation?: boolean;
  readonly onRestoreConversationComplete: () => void;
  readonly adapter: ChatConversationAdapter;
  /** See module doc comment, deviation 8. */
  readonly onRemoteChatMessageSync?: (messageGroup: Readonly<Record<string, unknown>>) => void;
  /** Presentational feedback the baseline sourced from `useToast()` — no toast/snackbar primitive exists yet in this app (see `features/mcps/model/useMcpAuthModal.ts`'s own doc comment for the established convention this follows). */
  readonly onInfo?: (message: string) => void;
  readonly onError?: (message: string) => void;
}

export interface UseApplicationChatResult {
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
  readonly applicationParticipant: Participant | null;
  readonly activeParticipantDetails: Readonly<Record<string, unknown>> | null;
  readonly disableAttachments: UseAgentAttachmentsResult['disableAttachments'];
  readonly attachments: UseAgentAttachmentsResult['attachments'];
  readonly onAttachFiles: UseAgentAttachmentsResult['onAttachFiles'];
  readonly onDeleteAttachment: UseAgentAttachmentsResult['onDeleteAttachment'];
  readonly onClearAttachments: UseAgentAttachmentsResult['onClearAttachments'];
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
