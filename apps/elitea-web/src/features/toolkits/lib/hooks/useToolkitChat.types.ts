/**
 * Shared param/result types for `./useToolkitChat.hooks.ts` — split out
 * purely to keep that file under the §3.5 400-line-per-file budget (see its
 * own module doc comment for the full citation list; this file carries no
 * behaviour of its own).
 */
import type { Message } from '@/entities/message';

import type { AddParticipantResult, CreateConversationResult, CreatedConversation, DefaultLlmSettings, ToolkitConversationValues } from '../helpers/toolkitConversation.helpers';
import type { IndexChatMessage } from '../../indexes/lib/helpers/indexChat.helpers';

export interface ToolkitChatModel {
  readonly name?: string;
  readonly project_id?: string;
  readonly default?: boolean;
  /** Drives `generateLlmSettings`'s `reasoning_effort` inclusion (`../helpers/toolkitConversation.helpers.ts`) — baseline: `llmSettings.utils.js`'s `modelSupportsReasoning`. */
  readonly supports_reasoning?: boolean;
}

/** Alias, not a duplicate — `../helpers/toolkitConversation.helpers.ts`'s `DefaultLlmSettings` already carries this exact shape (three named fields + an index signature for provider-specific extras). */
export type ToolkitChatLlmSettings = DefaultLlmSettings;

/**
 * The chat panel's message shape is genuinely mixed at runtime — a fresh
 * "run tool" turn produces `IndexChatMessage` (`../../indexes/lib/helpers/
 * indexChat.helpers.ts`, snake_case `created_at`/`participant_id`), while a
 * RECOVERED in-progress conversation produces `entities/message`'s `Message`
 * (camelCase `createdAt`, no `participant_id`). The baseline itself never
 * reconciled these two shapes (plain JS, no static typing); `useIndexHistory.
 * hooks.ts`'s own doc comment independently arrives at the same conclusion
 * for the identical reason (skips `ToolkitsHelpers.prettifyToolkitConversation`
 * rather than risk a silent no-op against the wrong field names) — this
 * union is the typed acknowledgement of that same real mismatch, not an
 * invented simplification.
 */
export type ToolkitChatMessage = IndexChatMessage | Message;

export interface ToolkitChatIndexLike {
  readonly id?: string;
  readonly metadata: {
    readonly state?: string;
    readonly conversation_id?: string;
    readonly collection?: string;
    readonly task_id?: string;
    readonly index_configuration?: Readonly<Record<string, unknown>>;
  };
}

export interface UseToolkitChatParams {
  readonly toolkitId: string | undefined;
  readonly runTool: string;
  readonly isValidForm: boolean;
  readonly toolInputVariables: Readonly<Record<string, unknown>> | undefined;
  readonly index: ToolkitChatIndexLike | undefined;
  readonly traceNewIndex: ((indexId: string | null, patch: Readonly<Record<string, unknown>>) => void) | undefined;
  readonly refetchIndexesList: () => void;
  readonly cancelIndexingCallback: ((tab: string) => void) | undefined;
  readonly values: ToolkitConversationValues;
  readonly modes: readonly string[];
  readonly onMcpAuthRequired: ((message: Readonly<Record<string, unknown>>) => void) | undefined;

  // ---- Injected: real, disclosed gaps (see hook's own module doc comment) ----
  /** Replaces `useToolkitSocketContext().isAuthCheckSession` — no such context exists in this app's `app/` (composition-root only, spec §3.2). */
  readonly isAuthCheckSession?: boolean;
  /** Replaces `useListModelsQuery` — no generated `ListModels` endpoint (mission brief's own disclosed gap). */
  readonly modelList: readonly ToolkitChatModel[];
  readonly defaultModel: ToolkitChatModel | null;
  /** Replaces `useConversationCreateMutation()` — no generated conversation-create endpoint. */
  readonly createConversation: (input: Readonly<Record<string, unknown>>) => Promise<CreateConversationResult>;
  /** Replaces `useAddParticipantIntoConversationMutation()` — no generated add-participant endpoint. */
  readonly addParticipant: (input: Readonly<Record<string, unknown>>) => Promise<AddParticipantResult>;
  /** Replaces `useStopIndexingItemMutation()` — no generated indexing-stop endpoint. */
  readonly stopIndexing: (input: { readonly projectId: string | undefined; readonly toolkitId: string | undefined; readonly indexName: string | undefined; readonly taskId: string | undefined }) => Promise<void>;
  /** Replaces `common/messagePayloadUtils.js`'s `generateMessagePayload` — pulls in `features/mcp`'s `McpAuthHelpers.getAllTokens()` (sideways-forbidden) and chat-domain LLM-settings filtering not in this slice's ownership. */
  readonly buildMessagePayload: (input: {
    readonly conversation_uuid: string | undefined;
    readonly interaction_uuid: string;
    readonly projectId: string | undefined;
    readonly selectedModel: ToolkitChatModel | null;
    readonly participant: { readonly entity_name?: string; readonly id?: string | number } | undefined;
    readonly llmSettings: ToolkitChatLlmSettings;
    readonly participants: readonly unknown[];
  }) => Readonly<Record<string, unknown>>;
  /** Replaces `useToast()` — no toast primitive in `shared/ui` yet (established precedent: `features/mcps/model/useMcpAuthModal.ts`'s own identical deviation). */
  readonly onSuccess?: ((message: string) => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}

export interface UseToolkitChatResult {
  readonly activeConversation: CreatedConversation | null;
  readonly chatHistory: readonly ToolkitChatMessage[];
  readonly isIndexing: boolean;
  readonly isFullScreenChat: boolean;
  readonly isRunning: boolean;
  readonly isStoppingIndexing: boolean;
  readonly handleClearActiveConversation: () => void;
  readonly handleClearChat: () => void;
  readonly handleIndexData: () => void;
  readonly handleRunTool: () => void;
  readonly llmSettings: ToolkitChatLlmSettings;
  readonly modelList: readonly ToolkitChatModel[];
  readonly onCancelIndexing: () => void;
  readonly onSelectModel: (model: ToolkitChatModel) => void;
  readonly onSetLLMSettings: (settings: Partial<ToolkitChatLlmSettings>) => void;
  readonly selectedModel: ToolkitChatModel | null;
  readonly stopRunOnIndexChange: () => void;
  readonly toggleFullScreenChat: (next: boolean) => void;
}
