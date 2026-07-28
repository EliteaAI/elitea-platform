import { useCallback } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { Participant } from '@/entities/participant';

import { useAutoSwitchApplicationChatVersion } from '../../model/useApplicationChatSwitchVersion';
import { buildActiveParticipantDetails, buildSwitchVersionInput, mergeSwitchedEntitySettings } from './applicationChat.helpers';
import { useApplicationChatConversation } from './useApplicationChatConversation.hooks';
import { useApplicationChatMessaging } from './useApplicationChatMessaging.hooks';
import { useApplicationChatSockets } from './useApplicationChatSockets.hooks';
import { useApplicationChatStreaming } from './useApplicationChatStreaming.hooks';

export type {
  ChatApplicationVersionDetails,
  ChatConversation,
  ChatConversationAdapter,
  ChatHistoryMessage,
  ChatSource,
  CreateConversationAdapterInput,
  CreateConversationAdapterResult,
  SendMessageData,
  SendResult,
  UseApplicationChatParams,
  UseApplicationChatResult,
} from './applicationChat.types';
import type { UseApplicationChatParams, UseApplicationChatResult } from './applicationChat.types';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/hooks/useApplicationChat.hooks.js`
 * — "largest file in A1" per this batch's brief. Encapsulates conversation
 * creation, socket handling, and state management for agent pages (both
 * Run and Configuration tabs).
 *
 * **Split across 5 files** (`applicationChat.types.ts`,
 * `applicationChat.helpers.ts`, `useApplicationChatConversation.hooks.ts`,
 * `useApplicationChatMessaging.hooks.ts`,
 * `useApplicationChatStreaming.hooks.ts`,
 * `useApplicationChatSockets.hooks.ts`) purely to keep every function under
 * this codebase's `complexity: 12`/`max-lines: 400` oxlint gates — this
 * file composes them; no behaviour differs from a single-file port. Each
 * sub-file's own doc comment covers its slice; only cross-cutting
 * deviations are repeated here.
 *
 * **REAL, VERIFIED BACKEND GAP — no conversation-domain REST endpoints
 * exist.** The baseline's core data layer is FIVE RTK Query hooks:
 * `useConversationCreateMutation`, `useConversationDetailsQuery`,
 * `useDeleteMessageFromConversationMutation`,
 * `useDeleteAllMessagesFromConversationMutation`, `useStopChatTaskMutation`.
 * Grepping this app's ENTIRE generated client (`shared/api/generated/**`)
 * for "conversation" turns up zero REST operations beyond
 * `useWebchatSync`/`useGetChatConfig` (`chat/chat.ts`) — no create, no
 * details-by-id, no message delete, no stop-task. This is not a porting
 * shortcut: there is currently nothing in `services/elitea-main`'s exposed
 * v2 API for any of these five operations. Rather than invent endpoints or
 * silently no-op, this hook takes a `ChatConversationAdapter`
 * (`applicationChat.types.ts`) — exactly the same "restructure via injected
 * callback, do not create a forbidden import (or, here, a FICTIONAL one)"
 * principle this batch's preamble already establishes for cross-feature
 * imports, applied to a missing-backend situation instead. A future chat-
 * domain unit supplies the real adapter once these endpoints exist; this
 * hook owns the orchestration (state machine, welcome message, streaming
 * tracking, socket wiring) around whatever adapter it is given.
 *
 * **DEVIATIONS FROM BASELINE (all disclosed):**
 *
 *  1. `useConversationDetailsQuery` (restore-by-id) -> `restoredConversationData`
 *     is a direct parameter (already-fetched data), not fetched by this
 *     hook — matching the adapter gap above, and keeping this hook's own
 *     job scoped to "conversation, socket, state" per its own baseline
 *     docstring, not HTTP fetching.
 *  2. `useIsFrom(RouteDefinitions.Pipelines)` (route-sniffing to decide
 *     `source: 'agent' | 'pipeline'`) -> an explicit `source` parameter.
 *     This hook is shared by BOTH agent and pipeline chat call sites in the
 *     baseline; route-sniffing inside a `features/agents`-owned file to
 *     detect "am I actually being used from pipelines" is backwards (and
 *     would need an upward `app`/`routes` import besides, forbidden by
 *     R-L1) — the caller already knows which context it is.
 *  3. `useChatMessageSyncSocket`/`useChatMessageDeleteSocket`
 *     (`@/components/Chat/hooks`, a 1600-line NON-owned legacy file) ->
 *     rebuilt directly atop `shared/api/socket/client.ts`'s real
 *     `useSocketClient().on/off` (unit S5, already landed) — same
 *     ref+callback+on/off shape, real infra, not a forbidden import (the
 *     legacy file isn't in this sub-unit's owned list and isn't promoted
 *     anywhere). See `useApplicationChatSockets.hooks.ts`.
 *  4. `useManualSocket(sioEvents.chat_enter_room)`/`chat_leave_rooms`
 *     (manual emit, called only on restore/create, NEVER on unmount in the
 *     baseline — a real room-membership leak, confirmed by reading the
 *     whole baseline file: no `emitLeaveRoom(activeConversation.id)` call
 *     exists anywhere in it) -> `shared/api/socket/rooms.ts`'s
 *     `useSocketRoom(activeConversation?.id)` (unit S5). Its own doc
 *     comment cites exactly this domain ("chat, application, pipeline and
 *     toolkit predict flows") as its intended consumer. A genuine
 *     improvement, not just a redesign: enter still fires the same way
 *     (once a real conversation id exists), and leave now actually fires on
 *     unmount, fixing the baseline's leak.
 *  5. `emitLeaveRoom([streamId])` (`onStopStreaming`/`onStopAll`, a
 *     DIFFERENT room concept — per-stream, not per-conversation) -> kept as
 *     a direct `useSocketClient().emit('chat_leave_rooms', [streamId])`
 *     call in `useApplicationChatStreaming.hooks.ts`, matching
 *     `leaveRoomsEmitSchema`'s explicit array-of-stream-ids support
 *     (`shared/api/socket/events.ts:88-97`, citing this exact baseline call
 *     site).
 *  6. `useApplicationChatSwitchVersion` (`hooks/application/`) -> this
 *     slice's own already-landed `useAutoSwitchApplicationChatVersion`
 *     (`features/agents/model/useApplicationChatSwitchVersion.ts`, intra-
 *     slice reuse, no deviation beyond that file's own already-disclosed
 *     ones).
 *  7. `useAgentAttachments` (`hooks/application/`) -> this slice's own
 *     already-landed `useAgentAttachments` (`features/agents/lib/
 *     useAgentAttachments.ts`, intra-slice reuse, wired inside
 *     `useApplicationChatConversation.hooks.ts`).
 *  8. `useSynAgentChatMessage` (confirmed NOT PROMOTED — preamble says
 *     "duplicate locally") -> its transitive dependency,
 *     `convertToAIAnswer` (`common/convertChatConversationMessages.js:111-
 *     313`), is itself ~200 lines that further depend on
 *     `collapseSubAgentInvocationKeys` (`features/chat`, not owned, not
 *     promoted) — porting the WHOLE chain here would compound this file's
 *     already-large disclosed-duplication debt for logic
 *     `entities/message/lib/normalise.ts`'s own doc comment explicitly
 *     scopes OUT of the entity layer as "a Wave-2 feature['s]" concern (the
 *     LIST-level chat-history merge, not per-message normalisation).
 *     `onRemoteChatMessageSync` is therefore an OPTIONAL injected callback:
 *     this hook wires the `chat_message_sync` subscription (deviation 3)
 *     and hands the raw payload to whatever the caller supplies: real
 *     merge logic once a chat-domain unit exists to own it.
 *  9. `eliteaApi.util.invalidateTags([{type: 'TAG_TYPE_CONVERSATION_DETAILS', ...}])`
 *     on the streaming-stopped transition -> DROPPED. There is no TanStack
 *     Query cache entry for "conversation details" in this app (gap
 *     above) — nothing to invalidate. The adapter (once real) owns its own
 *     cache lifecycle.
 *  10. `useFormikContext`/global Redux — none used in the baseline file
 *      itself: `setFieldValue` was ALREADY an explicit parameter in the
 *      baseline's own signature (not read via `useFormikContext()`), so no
 *      deviation is needed there.
 *  11. `streamingState.streamingMessages` (a redundant tracked `Set`, never
 *      exposed) -> dropped; see `useApplicationChatStreaming.hooks.ts`'s own
 *      `useIsStreaming` doc comment.
 */
export function useApplicationChat(params: UseApplicationChatParams): UseApplicationChatResult {
  const {
    applicationId,
    applicationName,
    applicationVersionDetails,
    projectId,
    setFieldValue,
    source = 'agent',
    restoredConversationID = null,
    restoredConversationData,
    isLoadingRestoredConversation = false,
    isErrorRestoredConversation = false,
    onRestoreConversationComplete,
    adapter,
    onRemoteChatMessageSync,
    onInfo,
    onError,
  } = params;

  const socket = useSocketClient();

  const conversation = useApplicationChatConversation({
    applicationId,
    applicationName,
    applicationVersionDetails,
    projectId,
    source,
    restoredConversationID,
    restoredConversationData,
    isLoadingRestoredConversation,
    isErrorRestoredConversation,
    onRestoreConversationComplete,
    onInfo,
    onError,
  });

  useApplicationChatSockets({
    conversationId: conversation.activeConversation?.id,
    conversationUuid: conversation.activeConversation?.uuid,
    projectId,
    onRemoteChatMessageSync,
    setChatHistory: conversation.setChatHistory,
  });

  const streaming = useApplicationChatStreaming({
    socket,
    adapter,
    projectId,
    applicationName,
    applicationVersionDetails,
    applicationParticipant: conversation.applicationParticipant,
    activeConversation: conversation.activeConversation,
    activeParticipantId: conversation.activeParticipant?.id,
    chatHistoryRef: conversation.chatHistoryRef,
    setChatHistory: conversation.setChatHistory,
    setActiveConversation: conversation.setActiveConversation,
    onInfo,
    onError,
  });

  const { onSend } = useApplicationChatMessaging({
    applicationName,
    applicationParticipant: conversation.applicationParticipant,
    applicationVersionDetails,
    projectId,
    source,
    adapter,
    activeConversationId: conversation.activeConversation?.id,
    setActiveConversation: conversation.setActiveConversation,
    setActiveParticipant: conversation.setActiveParticipant,
    onError,
  });

  const onChangeParticipantSettings = useCallback(
    (_participantId: string | number, updates: Readonly<Record<string, unknown>>) => {
      const llmSettings = (updates['entity_settings'] as { readonly llm_settings?: Record<string, unknown> } | undefined)?.llm_settings;
      if (!llmSettings) return;
      Object.entries(llmSettings).forEach(([key, value]) => setFieldValue(`version_details.llm_settings.${key}`, value));
    },
    [setFieldValue],
  );

  const onSetLLMSettings = useCallback(
    (newSettings: Readonly<Record<string, unknown>>) => {
      Object.entries(newSettings).forEach(([key, value]) => setFieldValue(`version_details.llm_settings.${key}`, value));
    },
    [setFieldValue],
  );

  const onSelectThisParticipant = useCallback(() => {}, []);
  const onClearActiveParticipant = useCallback(() => {}, []);

  // Auto-switch entity_settings when the version changes while a real conversation exists — see
  // `buildSwitchVersionInput`'s own doc comment for the "first version is never a switch" note.
  const switchVersionInput = buildSwitchVersionInput(
    projectId,
    conversation.activeConversation,
    conversation.activeParticipant,
    applicationVersionDetails,
  );
  const setActiveParticipant = conversation.setActiveParticipant;
  const onSwitchedVersion = useCallback(
    (entitySettings: Readonly<Record<string, unknown>>) => {
      setActiveParticipant((prev: Participant | null) => mergeSwitchedEntitySettings(prev, entitySettings));
    },
    [setActiveParticipant],
  );
  useAutoSwitchApplicationChatVersion(switchVersionInput, onSwitchedVersion);

  return {
    activeConversation: conversation.activeConversation,
    activeParticipant: conversation.activeParticipant,
    isCreatingConversation: conversation.isCreatingConversation,
    isStreaming: streaming.isStreaming,
    isLoadingConversation: conversation.isCreatingConversation || isLoadingRestoredConversation,
    setChatHistory: conversation.setChatHistory,
    setActiveConversation: conversation.setActiveConversation,
    onDeleteMessage: streaming.onDeleteMessage,
    onDeleteAllMessages: streaming.onDeleteAllMessages,
    onChangeParticipantSettings,
    onSetLLMSettings,
    onSend,
    onSelectThisParticipant,
    onClearActiveParticipant,
    onStopStreaming: streaming.onStopStreaming,
    onStopAll: streaming.onStopAll,
    applicationParticipant: conversation.applicationParticipant,
    activeParticipantDetails: buildActiveParticipantDetails(applicationId, applicationName, applicationVersionDetails, projectId),
    disableAttachments: conversation.disableAttachments,
    attachments: conversation.attachments,
    onAttachFiles: conversation.onAttachFiles,
    onDeleteAttachment: conversation.onDeleteAttachment,
    onClearAttachments: conversation.onClearAttachments,
  };
}
