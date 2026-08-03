/**
 * ChatBox — composition root for the chat experience.
 * Composes entities/conversation lifecycle + streaming,
 * features/chat-messages ChatMessageList, features/chat-input NewChatInput,
 * Phase-2 button primitives, Phase-4 recommendation list, and TTS.
 * Port of the old 2300-line ChatBox.jsx — split across sibling hooks
 * (data/state/handlers/participant/model-selection/internal-tools/
 * versioning/mentions/actions — see ./hooks/) plus a pure-helpers module
 * (./ChatBox.helpers.ts) to stay under the §3.5 file-length/component-props/
 * use-effects/complexity budgets.
 *
 * Lives in widgets/ (not features/) because a composition root that pulls
 * together chat-messages, chat-input, and chat-recommendations necessarily
 * imports sideways across those features — legal for widgets/, forbidden
 * for features/ (R-L1, `.dependency-cruiser.cjs`'s `no-sideways-features`).
 */
import type { ComponentRef } from 'react';
import { memo, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

import { Box } from '@mui/material';
import { useNavBlockerStore } from '@/widgets/app-shell';
import type { AttachmentButtonHandle, VoiceButtonHandle } from '@/widgets/chat';
import { ChatConversationStarters, NewChatInput, voiceHooks } from '@/features/chat-input';
import { useSocketClient } from '@/shared/api/socket/client';
import { ChatMessageList, useDeleteMessageAlert } from '@/features/chat-messages';
import { conversationApi } from '@/entities/conversation';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';

import {
  buildAgentEditorProps,
  buildChatBoxDataParams,
  buildChatBoxHandlerConversationDeps,
  buildChatBoxStateParams,
  buildTtsProps,
  buildUserParticipant,
  deriveChatBoxIds,
  deriveChatBoxInputState,
  flattenChatBoxProps,
  pickIdAndUuid,
  resolveConversationStarters,
} from './ChatBox.helpers';
import type { ChatBoxActiveConversation } from './ChatBox.helpers';
import { buildChatBoxInputSlots } from './ChatBoxInputSlots';
import { ChatBoxPopups } from './ChatBoxPopups';
import { useChatBoxData } from './hooks/useChatBoxData';
import { useChatBoxState } from './hooks/useChatBoxState';
import { useChatBoxHandlers } from './hooks/useChatBoxHandlers';
import { useChatBoxParticipant } from './hooks/useChatBoxParticipant';
import { useChatBoxModelSelection } from './hooks/useChatBoxModelSelection';
import { useChatBoxInternalTools } from './hooks/useChatBoxInternalTools';
import { useChatBoxVersioning } from './hooks/useChatBoxVersioning';
import { useChatBoxMentions } from './hooks/useChatBoxMentions';
import { useChatBoxActions } from './hooks/useChatBoxActions';
import { useSessionDeclinedMcpServersRef } from './hooks/useSessionDeclinedMcpServersRef';
import { useStableRef } from './hooks/useStableRef';

/** `NewChatInputHandle` stays unexported from `features/chat-input`'s barrel — derived via `ComponentRef`, matching that barrel's own documented convention. */
type NewChatInputHandle = ComponentRef<typeof NewChatInput>;

/* ------------------------------------------------------------------ */
/*  Props & handle                                                      */
/* ------------------------------------------------------------------ */

/** @public Props for the ChatBox composition root. */
export interface ChatBoxProps {
  readonly activeConversation?: ChatBoxActiveConversation;
  readonly hidden?: boolean;
  readonly fromTheChat?: boolean;
  readonly projectId?: string | number;
  /** Bundled to stay under the §3.5 component-props budget (one slot instead of three). */
  readonly user?: { readonly id?: string; readonly name?: string; readonly avatar?: string };
  readonly activeParticipant?: unknown;
  readonly onChangeParticipant?: (participant: unknown) => void;
  readonly setChatHistory?: React.Dispatch<React.SetStateAction<readonly unknown[]>>;
  readonly conversationStarters?: readonly { id: string; text: string }[];
  readonly isAgentsPage?: boolean;
  readonly isLoadingConversation?: boolean;
  /** Bundled to stay under the §3.5 component-props budget (one slot instead of two). */
  readonly llm?: { readonly settings?: Readonly<Record<string, unknown>>; readonly onSetSettings?: (settings: Readonly<Record<string, unknown>>) => void };
  /** Bundled to stay under the §3.5 component-props budget (one slot instead of two). */
  readonly onDelete?: { readonly answer?: (messageId: string) => void; readonly all?: () => void };
}

/** @public Imperative handle proxied from ChatBox. */
export interface ChatBoxHandle {
  readonly onClear: () => void;
  readonly mentionUser: (content: string) => void;
  readonly stopAll: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

const ChatBoxInner = memo(function ChatBox({
  activeConversation,
  hidden = false,
  projectId,
  user,
  activeParticipant,
  onChangeParticipant,
  setChatHistory,
  conversationStarters,
  isAgentsPage,
  isLoadingConversation,
  llm,
  onDelete,
}: ChatBoxProps) {
  const chatInputRef = useRef<NewChatInputHandle>(null);
  const attachmentButtonRef = useRef<AttachmentButtonHandle>(null); const voiceButtonRef = useRef<VoiceButtonHandle>(null);
  const { userId, userName, userAvatar, llmSettings, onSetLLMSettings, onDeleteAnswer, onDeleteAllMessages } = flattenChatBoxProps({ user, llm, onDelete });
  const { conversationId, conversationParticipants, conversationUuid, conversationMeta, isConversationSending, projectIdString } = deriveChatBoxIds(activeConversation, projectId);

  // Data layer
  const data = useChatBoxData(buildChatBoxDataParams({ activeConversation, activeParticipant, projectId, userId, userName, userAvatar, isAgentsPage }));
  const messages = data.messageList.messages;
  const isStreaming = data.streaming.isStreamingNow || data.messageList.isStreamingFromHistory;

  // Participant normalisation + details fetch
  const { participantForEditor, normalisedParticipants, agentEditorParticipantDetails, isFetchingParticipantDetails } = useChatBoxParticipant({
    activeParticipant,
    conversationParticipants,
  });
  const activeParticipantVersions = agentEditorParticipantDetails?.versions;

  // Local state (mentions, slash/skill phases, participant guards, etc.) —
  // called after participant normalisation so its version-missing guard can
  // consume `agentEditorParticipantDetails`'s resolved version list.
  const state = useChatBoxState(buildChatBoxStateParams({
    activeParticipant: participantForEditor,
    participants: normalisedParticipants,
    userId,
    conversationStarters,
    isAgentsPage,
    chatInput: chatInputRef,
    projectId,
    activeParticipantVersions,
  }));

  // Socket client + read-aloud (TTS)
  const socketClient = useSocketClient();
  const readAloud = voiceHooks.useReadAloud({
    projectId: projectIdString,
    socket: socketClient,
  });
  const lifecycle = data.lifecycle;

  // Mirror the live, socket-synced history out to the parent's own mirror,
  // when one is supplied (no live caller exists yet — the routing gap this
  // whole unit operates under).
  useEffect(() => {
    setChatHistory?.(messages);
  }, [messages, setChatHistory]);

  // Nav blocker
  const setStreamingBlockNav = useNavBlockerStore((s) => s.setStreamingBlockNav);
  useEffect(() => {
    setStreamingBlockNav(data.streaming.isStreamingNow, 'prompt');
  }, [data.streaming.isStreamingNow, setStreamingBlockNav]);

  // Session-scoped bookkeeping of MCP servers declined/authenticated this
  // conversation (never persisted) — resets whenever the conversation changes.
  const sessionDeclinedMcpServersRef = useSessionDeclinedMcpServersRef(conversationUuid);

  // Real RTK/TanStack mutations the action handlers below trigger.
  const { mutateAsync: regenerateMutateAsync } = conversationApi.useRegenerate();
  const { mutateAsync: deleteMessageMutateAsync } = conversationApi.useDeleteMessage();
  const { mutateAsync: deleteAllMessagesMutateAsync } = conversationApi.useDeleteAllMessages();
  const { mutateAsync: stopChatTaskMutateAsync } = conversationApi.useStopTask();

  const createConversationForSend = useCallback(
    async (question: string) => {
      const created = await lifecycle.createConversation({ name: question.slice(0, 50) || t('widgets.chatBox.defaultConversationName', 'New Chat'), isPrivate: true });
      return created ? pickIdAndUuid(created) : undefined;
    },
    [lifecycle],
  );
  const uploadAttachmentsForSend = useCallback(
    async (conversationId: string | number, files: readonly File[]) => {
      const cfg = getConfig();
      if (cfg.status !== 'ok' || projectId === undefined) return { success: true, uploaded: [] };
      const outcome = await data.attachments.upload.uploadAttachments({
        baseUrl: cfg.config.vite_server_url,
        projectId: String(projectId),
        conversationId: String(conversationId),
        attachments: files,
      });
      return { success: outcome.success, uploaded: outcome.uploaded };
    },
    [projectId, data.attachments.upload],
  );

  // Action handlers — real socket protocol (chat_predict / chat_continue_predict),
  // real REST mutations, real conversation-creation-first send ordering.
  const handlers = useChatBoxHandlers({
    // eslint-disable-next-line typescript/unbound-method -- `emit` is a plain closure over `socket` (shared/api/socket/client.ts), never reads `this`
    emitSocket: socketClient.emit,
    chatHistory: messages,
    setChatHistory: data.setChatHistory,
    isStreamingNow: data.streaming.isStreamingNow,
    setStreamingInfo: data.streaming.setStreamingInfo,
    createConversation: createConversationForSend,
    uploadAttachments: uploadAttachmentsForSend,
    triggerRegenerate: regenerateMutateAsync,
    triggerDeleteMessage: deleteMessageMutateAsync,
    triggerDeleteAllMessages: deleteAllMessagesMutateAsync,
    triggerStopChatTask: stopChatTaskMutateAsync,
    getUserParticipant: () => buildUserParticipant(userId, userName, userAvatar),
    getActiveParticipant: () => activeParticipant,
    ...buildChatBoxHandlerConversationDeps(activeConversation),
    projectId,
    socketId: socketClient.socket.id,
    sessionDeclinedMcpServersRef,
  });

  // Delete confirmation (single message / clear-all) — baseline:
  // `useDeleteMessageAlert.hooks.js`'s confirm-then-delete gating.
  const deleteAlert = useDeleteMessageAlert({
    onDeleteChatMessage: async (messageId) => {
      await handlers.deleteAnswer(messageId);
      onDeleteAnswer?.(messageId);
    },
    onDeleteAllChatMessages: async () => {
      await handlers.clearChat();
      onDeleteAllMessages?.();
    },
  });

  // LLM model list + selection
  const { modelsList, selectedLlmModel, handleSelectModel } = useChatBoxModelSelection({
    projectId,
    selectedModelName: data.selectedModel?.name,
    setSelectedModel: data.setSelectedModel,
  });

  // Real internal-tools-config persistence
  const { internalToolsButtonTools, handleInternalToolChange, isUpdatingInternalToolsConfig } = useChatBoxInternalTools({
    conversationId,
    conversationMeta,
    projectId,
    isAgentsPage,
  });

  // Version selection (real fetch + persist) + auto-recovery
  const { handleSelectVersion } = useChatBoxVersioning({
    participantForEditor,
    projectId,
    activeConversationId: conversationId,
    activeParticipant,
    onChangeParticipant,
    isActiveParticipantVersionMissing: state.isActiveParticipantVersionMissing,
    activeParticipantVersions,
  });

  // "@" mention -> send-to-user/everyone routing, "~" skill selection
  const { handleMentionChange, handleSelectUserMention, handleSelectSkillTool } = useChatBoxMentions({ state, onChangeParticipant });

  // Input disable/loading derivation
  const { isInputLoading, disabledSend } = deriveChatBoxInputState({
    isLoadingConversation,
    isFetchingParticipantDetails,
    isUploadingAttachments: data.attachments.upload.isUploading,
    isUpdatingInternalToolsConfig,
    isConversationSending,
    isStreaming,
    hasChatInput: !!chatInputRef.current,
    isProcessingSymbols: state.keyDown.isProcessingSymbols,
    hasPendingHitlInterrupt: data.hasPendingHitlInterrupt,
    isActiveParticipantBroken: state.isActiveParticipantBroken,
  });

  // Action callbacks (send, regenerate, copy, delete, edit-resubmit, HITL
  // resume, MCP/token-limit continue, clear chat, conversation-starter send)
  const readAloudRef = useStableRef(readAloud);
  const readAloudStop = useCallback(() => { readAloudRef.current.stop(); }, [readAloudRef]);
  const {
    handleSend,
    handleSendStarter,
    handleRegenerate,
    handleCopy,
    handleDeleteAnswer,
    handleSubmitEditedMessage,
    handleHitlResume,
    handleContinueMcpExecution,
    handleContinueTokenLimit,
    handleClear,
  } = useChatBoxActions({ chatInputRef, data, state, handlers, deleteAlert, messages, isAgentsPage, readAloudStop });

  // Imperative handle (stable via refs, so identity never churns)
  const handleClearRef = useStableRef(handleClear);
  const streamingRef = useStableRef(data.streaming);
  useImperativeHandle(
    chatInputRef as unknown as React.Ref<ChatBoxHandle>,
    () => ({
      onClear: () => { handleClearRef.current(); },
      mentionUser: (c) => { chatInputRef.current?.setValue?.(`@${c} `); },
      stopAll: () => { streamingRef.current.stopStreaming(); },
    }),
    [handleClearRef, streamingRef],
  );

  // Early return
  if (hidden) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <Box sx={{ flex: 1, minHeight: 0, px: 2 }}>
        <ChatMessageList
          chatHistory={messages} isStreaming={isStreaming} userId={userId ?? ''}
          messageActions={{
            onCopyToClipboard: handleCopy,
            onDeleteAnswer: handleDeleteAnswer,
            onRegenerateAnswer: handleRegenerate,
            onSubmitEditedMessage: handleSubmitEditedMessage,
          }}
          continuation={{
            onHitlResume: handleHitlResume,
            onContinueMcpExecution: handleContinueMcpExecution,
            onContinueTokenLimitExecution: handleContinueTokenLimit,
          }}
          tts={buildTtsProps(readAloud)}
        />
        {state.shouldShowStarters && (
          <ChatConversationStarters
            onSend={handleSendStarter}
            conversationStarters={resolveConversationStarters(state.hasStarterBeenSent, messages.length, conversationStarters)}
          />
        )}
      </Box>
      <Box sx={{ p: 1 }}>
        <ChatBoxPopups
          recommendations={{
            show: state.showRecommendationList,
            onSelectParticipant: (p) => { onChangeParticipant?.(p); state.setShowRecommendationList(false); },
            onClose: () => state.setShowRecommendationList(false),
            existingParticipants: conversationParticipants ?? [],
            projectId: projectIdString,
          }}
          userMentions={{
            isProcessingAtSymbol: state.keyDown.isProcessingAtSymbol,
            hasOtherUsers: state.hasOtherUsers,
            users: state.users,
            atQuery: state.keyDown.atQuery,
            onSelectUser: handleSelectUserMention,
            onClose: state.keyDown.stopProcessingAtSymbol,
          }}
          slash={state.slash}
          skill={{
            isActive: state.isSkillPhaseActive,
            filteredItems: state.skill.filteredItems,
            highlightedIndex: state.skill.highlightedIndex,
            onSelectTool: handleSelectSkillTool,
          }}
        />
        <NewChatInput
          ref={chatInputRef}
          conversationId={conversationId !== undefined ? String(conversationId) : undefined}
          state={{ isLoading: isInputLoading, isStreaming, disabledSend, isCreatingConversation: data.lifecycle.isCreating }}
          content={{ placeholder: t('widgets.chatBox.inputPlaceholder', 'Type a message...'), clearInputAfterSubmit: true, slashHighlights: state.combinedHighlightRanges }}
          callbacks={{ onSend: handleSend, onStopGeneration: data.streaming.stopStreaming, onNormalKeyDown: state.onNormalKeyDown, onInputChange: state.onInputChange }}
          agentEditor={buildAgentEditorProps({
            participantForEditor,
            activeParticipantDetails: agentEditorParticipantDetails,
            isAgentsPage,
            selectSavedOrDefaultModel: data.selectSavedOrDefaultModel,
            onShowParticipantsList: () => state.setShowRecommendationList(!state.showRecommendationList),
            onSelectVersion: (version) => { void handleSelectVersion(version); },
          })}
          mentions={{ users: state.users, onMentionChange: handleMentionChange }}
          voice={{ isSpeakingMode: state.isSpeakingMode, onSpeakingModeToggle: () => state.setIsSpeakingMode(!state.isSpeakingMode), isTTSPlaying: readAloud.isPlaying }}
          slots={buildChatBoxInputSlots({
            attachments: { attachments: data.attachments.state.attachments, onAttachFiles: data.attachments.state.onAttachFiles },
            internalTools: { disabled: isInputLoading, tools: internalToolsButtonTools, onToolChange: handleInternalToolChange },
            model: { llmSettings, onSetLLMSettings, selectedModel: selectedLlmModel, onSelectModel: handleSelectModel, models: modelsList },
            refs: { attachmentButtonRef, voiceButtonRef, voiceInputRef: chatInputRef },
          })}
          refs={{ attachmentButtonRef, voiceButtonRef }}
        />
      </Box>
      <DeleteEntityModal
        open={deleteAlert.isOpen}
        onClose={deleteAlert.closeDialog}
        onConfirm={() => { void deleteAlert.confirmDelete(); }}
        copy={{
          title: deleteAlert.isAllMessages ? t('widgets.chatBox.clearChatTitle', 'Clear chat') : t('widgets.chatBox.deleteMessageTitle', 'Delete message'),
          textContent: deleteAlert.confirmationMessage,
        }}
        content={{ inline: '' }}
        data-testid="chat-delete-confirm-dialog"
      />
    </Box>
  );
});

const ChatBox = memo(ChatBoxInner);
ChatBox.displayName = 'ChatBox';

export default ChatBox;
