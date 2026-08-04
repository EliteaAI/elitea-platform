import { useCallback, useEffect } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { Participant } from '@/entities/participant';

import { useAutoSwitchPipelineChatVersion } from './usePipelineChatSwitchVersion';
import { buildActiveParticipantDetails, buildSwitchVersionInput, mergeSwitchedEntitySettings } from './pipelineChat.helpers';
import { usePipelineChatConversation } from './usePipelineChatConversation.hooks';
import { usePipelineChatMessaging } from './usePipelineChatMessaging.hooks';
import { usePipelineChatSockets } from './usePipelineChatSockets.hooks';
import { usePipelineChatStreaming } from './usePipelineChatStreaming.hooks';

// Only the three types this sub-unit's own `ConfigurationTab.tsx` actually imports through this
// barrel are re-exported here (verified via `npx knip`: the rest had zero real consumers anywhere
// in this worktree, so re-exporting them would be speculative surface, not real coverage — a
// future consumer of `ChatConversation`/`ChatHistoryMessage`/etc. can still reach them via a
// direct intra-slice import from `./pipelineChat.types`, R-L3-legal either way).
export type { ChatConversationAdapter, ChatPipelineVersionDetails, UsePipelineChatResult } from './pipelineChat.types';
import type { UsePipelineChatParams, UsePipelineChatResult } from './pipelineChat.types';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/lib/hooks/
 * usePipelineChat.hooks.js` (762 LOC, the largest hook in the domain per
 * this sub-unit's own mission brief). Encapsulates conversation creation,
 * socket handling, and state management for pipeline pages' Configuration
 * tab test-chat pane.
 *
 * **Split across 6 files** (`pipelineChat.types.ts`, `pipelineChat.helpers.ts`,
 * `usePipelineChatConversation.hooks.ts`, `usePipelineChatMessaging.hooks.ts`,
 * `usePipelineChatStreaming.hooks.ts`, `usePipelineChatSockets.hooks.ts`)
 * purely to keep every function under this codebase's `complexity: 12`/
 * `max-lines: 400` oxlint gates — this file composes them; no behaviour
 * differs from a single-file port. This mirrors `features/agents/lib/hooks/
 * useApplicationChat.hooks.ts`'s identical split for the sibling baseline
 * hook (the two baseline files share the same conversation/socket/streaming
 * shape almost line for line — the mission preamble's own "a Pipeline is
 * literally an Application row" precedent applies equally to this chat
 * hook), NOT imported from `features/agents` (`no-sideways-features`
 * forbids it) — every sub-file here is this sub-unit's own duplicate/port,
 * not a re-export.
 *
 * **REAL, VERIFIED BACKEND GAP — no conversation-domain REST endpoints
 * exist.** Same gap `useApplicationChat.hooks.ts` already documents:
 * grepping this app's ENTIRE generated client (`shared/api/generated/**`)
 * for "conversation" turns up zero REST operations beyond
 * `useWebchatSync`/`useGetChatConfig` (`chat/chat.ts`) — no create, no
 * details-by-id, no message delete, no stop-task. This hook takes an
 * injected `ChatConversationAdapter` (`pipelineChat.types.ts`) rather than
 * invent endpoints or silently no-op; a future chat-domain unit supplies the
 * real adapter once these endpoints exist.
 *
 * **DEVIATIONS FROM BASELINE (all disclosed, matching `useApplicationChat.
 * hooks.ts`'s own numbered list for the identical baseline situations):**
 *  1. `useConversationDetailsQuery` (restore-by-id) -> `restoredConversationData`
 *     is a direct parameter (already-fetched data), not fetched here.
 *  2. `useIsFrom(RouteDefinitions.Pipelines)`/hardcoded `source: 'pipeline'`
 *     literal -> this hook is pipeline-only in the baseline already (unlike
 *     `useApplicationChat`, which is shared with agents), so `source` is
 *     simply always `'pipeline'` — no parameter needed, no route-sniffing
 *     either way.
 *  3. `useChatMessageSyncSocket`/`useChatMessageDeleteSocket`
 *     (`@/components/Chat/hooks`, not owned, not promoted) -> unit S5's
 *     `useSocketClient().on/off` — see `usePipelineChatSockets.hooks.ts`.
 *  4. `useManualSocket(sioEvents.chat_enter_room)`/`chat_leave_rooms` (never
 *     balanced with a leave on unmount anywhere in the baseline — a real
 *     room-membership leak) -> `shared/api/socket/rooms.ts`'s
 *     `useSocketRoom` (that file's own doc comment cites THIS baseline file
 *     by name/line as evidence for its `context` option).
 *  5. `emitLeaveRoom([streamId])` (a DIFFERENT, per-stream room concept) ->
 *     kept as a direct `useSocketClient().emit('chat_leave_rooms',
 *     [streamId])` call in `usePipelineChatStreaming.hooks.ts`.
 *  6. `useApplicationChatSwitchVersion` (`hooks/application/`, confirmed
 *     NOT-PROMOTED per this mission's preamble) -> this sub-unit's own
 *     duplicate, `useAutoSwitchPipelineChatVersion`
 *     (`usePipelineChatSwitchVersion.ts`).
 *  7. `useAgentAttachments` (`hooks/application/`, same not-promoted class)
 *     -> this sub-unit's own duplicate, `usePipelineAttachments`
 *     (`usePipelineAttachments.ts`), wired inside
 *     `usePipelineChatConversation.hooks.ts`.
 *  8. `useSynAgentChatMessage` (confirmed NOT PROMOTED per the preamble) ->
 *     its transitive dependency `convertToAIAnswer`
 *     (`common/convertChatConversationMessages.js:111-313`) itself depends
 *     on `collapseSubAgentInvocationKeys` (`features/chat`, not owned, not
 *     promoted, and that slice does not exist in this app yet). Porting the
 *     whole chain here would duplicate chat-domain merge logic
 *     `entities/message/lib/normalise.ts`'s own doc comment already scopes
 *     OUT of the entity layer. `onRemoteChatMessageSync` is therefore an
 *     OPTIONAL injected callback (see `pipelineChat.types.ts`'s own doc
 *     comment on that field) — this hook wires the real
 *     `chat_message_sync` subscription and hands the raw payload to
 *     whatever the caller supplies.
 *  9. `eliteaApi.util.invalidateTags(...)` on the streaming-stopped
 *     transition -> DROPPED. There is no TanStack Query cache entry for
 *     "conversation details" in this app (gap above) — nothing to
 *     invalidate.
 *  10. `useFormikContext`/global Redux — none used in the baseline file
 *      itself: `setFieldValue` was ALREADY an explicit parameter in the
 *      baseline's own signature, so no deviation is needed there.
 *  11. `streamingState.streamingMessages` (redundant tracked `Set`, never
 *      exposed) -> dropped; see `usePipelineChatStreaming.hooks.ts`'s own
 *      `useIsStreaming` doc comment.
 */
export function usePipelineChat(params: UsePipelineChatParams): UsePipelineChatResult {
  const {
    pipelineId,
    pipelineName,
    pipelineVersionDetails,
    projectId,
    setFieldValue,
    restoredConversationID = null,
    restoredConversationData,
    isLoadingRestoredConversation = false,
    isErrorRestoredConversation = false,
    onRestoreConversationComplete,
    adapter,
    deleteAllRunNodes,
    onRemoteChatMessageSync,
    onInfo,
    onError,
  } = params;

  const socket = useSocketClient();

  const conversation = usePipelineChatConversation({
    pipelineId,
    pipelineName,
    pipelineVersionDetails,
    projectId,
    source: 'pipeline',
    restoredConversationID,
    restoredConversationData,
    isLoadingRestoredConversation,
    isErrorRestoredConversation,
    onRestoreConversationComplete,
    onInfo,
    onError,
  });

  usePipelineChatSockets({
    conversationId: conversation.activeConversation?.id,
    conversationUuid: conversation.activeConversation?.uuid,
    projectId,
    onRemoteChatMessageSync,
    setChatHistory: conversation.setChatHistory,
  });

  const streaming = usePipelineChatStreaming({
    socket,
    adapter,
    projectId,
    pipelineName,
    pipelineVersionDetails,
    pipelineParticipant: conversation.pipelineParticipant,
    activeConversation: conversation.activeConversation,
    activeParticipantId: conversation.activeParticipant?.id,
    chatHistoryRef: conversation.chatHistoryRef,
    setChatHistory: conversation.setChatHistory,
    setActiveConversation: conversation.setActiveConversation,
    onInfo,
    onError,
  });

  const { onSend, isLoadingConversation: isSendingFirstMessage } = usePipelineChatMessaging({
    pipelineName,
    pipelineParticipant: conversation.pipelineParticipant,
    pipelineVersionDetails,
    projectId,
    source: 'pipeline',
    adapter,
    activeConversationId: conversation.activeConversation?.id,
    setActiveConversation: conversation.setActiveConversation,
    setActiveParticipant: conversation.setActiveParticipant,
    onError,
  });

  const onChangeParticipantSettings = useCallback(
    (participantId: string | number, updates: Readonly<Record<string, unknown>>) => {
      // Baseline `usePipelineChat.hooks.js:640-642` guard — skip updating the model on
      // initial settings if the pipeline details are not fully loaded yet. The baseline
      // used `useMatch({ path: RouteDefinitions.CreatePipeline })` for `isCreating`; this
      // hook has no router dependency, so `pipelineId` (already a param, `undefined` only
      // for a not-yet-created pipeline) stands in as the equivalent "am I creating a brand
      // new pipeline" signal.
      const isCreating = pipelineId === undefined;
      if (!participantId && !isCreating) return;
      const llmSettings = (updates['entity_settings'] as { readonly llm_settings?: Record<string, unknown> } | undefined)?.llm_settings;
      if (!llmSettings) return;
      Object.entries(llmSettings).forEach(([key, value]) => setFieldValue(`version_details.llm_settings.${key}`, value));
    },
    [pipelineId, setFieldValue],
  );

  const onSetLLMSettings = useCallback(
    (newSettings: Readonly<Record<string, unknown>>) => {
      Object.entries(newSettings).forEach(([key, value]) => setFieldValue(`version_details.llm_settings.${key}`, value));
    },
    [setFieldValue],
  );

  const onSelectThisParticipant = useCallback(() => {}, []);
  const onClearActiveParticipant = useCallback(() => {}, []);

  const switchVersionInput = buildSwitchVersionInput(
    projectId,
    conversation.activeConversation,
    conversation.activeParticipant,
    pipelineVersionDetails,
  );
  const setActiveParticipant = conversation.setActiveParticipant;
  const onSwitchedVersion = useCallback(
    (entitySettings: Readonly<Record<string, unknown>>) => {
      setActiveParticipant((prev: Participant | null) => mergeSwitchedEntitySettings(prev, entitySettings));
    },
    [setActiveParticipant],
  );
  useAutoSwitchPipelineChatVersion(switchVersionInput, onSwitchedVersion, onError);

  // Baseline `usePipelineChat.hooks.js:699-704` — reset chat history and clear any
  // in-progress flow-editor run nodes whenever the version being edited changes.
  // The chat-history reset itself is already handled by `usePipelineChatConversation`'s
  // own version-id effect (mirroring `useApplicationChatConversation.hooks.ts`'s identical
  // restructuring); `deleteAllRunNodes` is pipeline-specific (no agent-domain equivalent)
  // and stays here, on the same `[pipelineVersionDetails?.id]` trigger.
  useEffect(() => {
    deleteAllRunNodes?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineVersionDetails?.id]);

  return {
    activeConversation: conversation.activeConversation,
    activeParticipant: conversation.activeParticipant,
    isCreatingConversation: conversation.isCreatingConversation,
    isStreaming: streaming.isStreaming,
    // `conversation.isCreatingConversation`/`isLoadingRestoredConversation` are kept for parity with
    // baseline's own `isLoadingConversation || isLoadingRestoredConversation || isRestoringConversation`
    // (`usePipelineChat.hooks.js:726`), but neither reflects a real in-flight network request on its
    // own here (see `usePipelineChatMessaging.hooks.ts`'s `isLoadingConversation` doc comment for why
    // the local `isCreatingConversation` flag can never be observed `true`). `isSendingFirstMessage`
    // is the fix: it tracks the actual `adapter.createConversation(...)` round-trip baseline's own
    // `useConversationCreateMutation().isLoading` measured.
    isLoadingConversation: conversation.isCreatingConversation || isLoadingRestoredConversation || isSendingFirstMessage,
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
    pipelineParticipant: conversation.pipelineParticipant,
    activeParticipantDetails: buildActiveParticipantDetails(pipelineId, pipelineName, pipelineVersionDetails, projectId),
    disableAttachments: conversation.disableAttachments,
    attachments: conversation.attachments,
    onAttachFiles: conversation.onAttachFiles,
    onDeleteAttachment: conversation.onDeleteAttachment,
    onClearAttachments: conversation.onClearAttachments,
  };
}
