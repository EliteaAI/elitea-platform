import type { ComponentType, ReactNode } from 'react';

import type { ChatMessageListProps, LLMModelSelectorProps } from '../../indexes/ui/IndexDetails/IndexChat';
import type { AddParticipantResult, CreateConversationResult, ToolkitConversationValues } from '../../lib/helpers/toolkitConversation.helpers';
import type { ToolkitChatModel, UseToolkitChatParams } from '../../lib/hooks/useToolkitChat.types';
import type { IndexRow } from '../../indexes/model/indexesStore';

/**
 * `TestTools.tsx`'s (Wave-2 unit A4f) own prop/DI-group types — split out
 * purely to keep that file under the §3.5 400-line-per-file budget (see
 * its own module doc comment for the full citation list; this file carries
 * no behaviour of its own, matching `useToolkitChat.types.ts`'s identical
 * split-for-budget precedent one directory up).
 */

/**
 * `LLMModelSelector`/`ChatMessageList`/`ClearChatButton` — see `TestTools.tsx`'s
 * module doc comment, deviation 3. Not exported on its own (knip: no
 * caller needs to name this type directly — `TestToolsProps.chatUI` below
 * is the only real consumer, and TS does not require importing a
 * same-file, non-exported type to reference it structurally through an
 * exported interface field).
 */
interface TestToolsChatUI {
  readonly LLMModelSelector: ComponentType<LLMModelSelectorProps>;
  readonly ChatMessageList: ComponentType<ChatMessageListProps>;
  readonly ClearChatButton: ComponentType<{ readonly onClear: () => void }>;
}

/** `useToolkitChat`'s own five disclosed missing-endpoint gaps, propagated one level up — see `TestTools.tsx`'s module doc comment, deviation 6. Not exported — same reasoning as `TestToolsChatUI` above. */
interface TestToolsChatSession {
  readonly modelList: readonly ToolkitChatModel[];
  readonly defaultModel: ToolkitChatModel | null;
  readonly createConversation: (input: Readonly<Record<string, unknown>>) => Promise<CreateConversationResult>;
  readonly addParticipant: (input: Readonly<Record<string, unknown>>) => Promise<AddParticipantResult>;
  readonly stopIndexing: (input: { readonly projectId: string | undefined; readonly toolkitId: string | undefined; readonly indexName: string | undefined; readonly taskId: string | undefined }) => Promise<void>;
  readonly buildMessagePayload: UseToolkitChatParams['buildMessagePayload'];
  readonly onSuccess?: ((message: string) => void) | undefined;
  readonly onError?: ((message: string) => void) | undefined;
}

export interface TestToolsProps {
  readonly showAdvancedSettings: boolean;
  readonly isFullScreenChat: boolean;
  readonly setIsFullScreenChat: (value: boolean) => void;
  readonly toolkitId: string;
  readonly onShowHistory?: (() => void) | undefined;
  /** Replaces `useFormikContext().values` — see `TestTools.tsx`'s module doc comment, deviation 1. */
  readonly values: ToolkitConversationValues;
  /** Optional "server-side index rows" seam for `useIndexNameValidation` — see `TestTools.tsx`'s module doc comment, deviation 8. */
  readonly serverIndexes?: readonly IndexRow[] | undefined;
  readonly chatUI: TestToolsChatUI;
  readonly chatSession: TestToolsChatSession;
  /** Threads into `useToolkitChat`'s own same-named param — see `TestTools.tsx`'s module doc comment, deviation 2. */
  readonly onMcpAuthRequired: (message: Readonly<Record<string, unknown>>) => void;
  /** Rendered verbatim where the baseline rendered `<McpAuthModal {...getModalProps()} />` — see `TestTools.tsx`'s module doc comment, deviation 2. */
  readonly mcpAuthModal?: ReactNode | undefined;
}
