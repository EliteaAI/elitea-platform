/**
 * ChatBox — composition root for the chat experience.
 * Composes entities/conversation lifecycle + streaming,
 * features/chat-messages ChatMessageList, features/chat-input NewChatInput,
 * Phase-2 button primitives, Phase-4 recommendation list, and TTS.
 * Port of the old 2300-line ChatBox.jsx — split across sibling hooks.
 */
import { memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { Box } from '@mui/material';
import { AttachmentButton, ChatInternalToolsConfigButton, VoiceButton } from '@/widgets/chat';
import { useNavBlockerStore } from '@/widgets/app-shell';
import { NewChatInput } from '@/features/chat-input';
import type { NewChatInputHandle } from '@/features/chat-input/ui/NewChatInput.types';
import RecommendationList from '@/features/chat-recommendations/ui/RecommendationList';
import { useReadAloud } from '@/features/chat-input/lib/hooks/useReadAloud.hooks';
import { useSocketClient } from '@/shared/api/socket/client';
import { ChatMessageList, convertMessagesToChatHistory } from '@/features/chat-messages';
import type { ChatMessage } from '@/features/chat-messages';
import type { MessageGroupWire, MessageParticipantWire } from '@/entities/message';

import { useChatBoxData } from './hooks/useChatBoxData';
import { useChatBoxState } from './hooks/useChatBoxState';

/* ------------------------------------------------------------------ */
/*  Props & handle                                                      */
/* ------------------------------------------------------------------ */

/** @public Props for the ChatBox composition root. */
export interface ChatBoxProps {
  readonly activeConversation?: {
    readonly id?: string | number; readonly uuid?: string; readonly name?: string;
    readonly isNew?: boolean; readonly participants?: unknown[];
    readonly message_groups?: MessageGroupWire[];
    readonly isPlayback?: boolean; readonly isSending?: boolean;
    readonly meta?: Readonly<Record<string, unknown>>;
  };
  readonly hidden?: boolean;
  readonly fromTheChat?: boolean;
  readonly projectId?: string | number;
  readonly userId?: string; readonly userName?: string; readonly userAvatar?: string;
  readonly activeParticipant?: unknown;
  readonly onChangeParticipant?: (participant: unknown) => void;
  readonly setChatHistory?: React.Dispatch<React.SetStateAction<readonly unknown[]>>;
  readonly conversationStarters?: readonly { id: string; text: string }[];
  readonly isAgentsPage?: boolean;
  readonly isLoadingConversation?: boolean;
  readonly llmSettings?: Readonly<Record<string, unknown>>;
  readonly onSetLLMSettings?: (settings: Readonly<Record<string, unknown>>) => void;
  readonly onDeleteAnswer?: (messageId: string) => void;
  readonly onDeleteAllMessages?: () => void;
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
  userId,
  userName: _userName,
  userAvatar: _userAvatar,
  activeParticipant,
  onChangeParticipant,
  setChatHistory,
  conversationStarters,
  isAgentsPage,
  isLoadingConversation,
  onDeleteAnswer,
}: ChatBoxProps) {
  const chatInputRef = useRef<NewChatInputHandle>(null);
  const [_, setChatHistoryState] = useState<readonly unknown[]>([]);

  // Data layer
  const data = useChatBoxData({
    conversationId: activeConversation?.id ?? undefined,
    conversationUuid: activeConversation?.uuid ?? undefined,
    participants: activeConversation?.participants,
    messageGroups: activeConversation?.message_groups,
    activeParticipant,
    projectId: projectId ?? undefined,
    userId: userId ?? undefined,
    userName: _userName,
    userAvatar: _userAvatar,
    isAgentsPage: isAgentsPage ?? undefined,
    conversationIsPlayingBack: !!activeConversation?.isPlayback,
  });

  // Local state
  const state = useChatBoxState({
    activeParticipant,
    participants: activeConversation?.participants,
    userId: userId ?? undefined,
    conversationStarters: (conversationStarters ?? []) as Array<{ id: string; text: string }>,
    isAgentsPage,
  });

  // Socket client
  const socketClient = useSocketClient();

  // Read-aloud (TTS)
  const readAloud = useReadAloud({
    projectId: projectId !== undefined ? String(projectId) : undefined,
    socket: socketClient,
  });

  const lifecycle = data.lifecycle;

  // Chat history sync
  useEffect(() => {
    if (activeConversation?.message_groups && setChatHistory) {
      const msgs = convertMessagesToChatHistory(
        activeConversation.message_groups,
        activeConversation.participants as MessageParticipantWire[] | undefined,
      );
      setChatHistoryState(msgs as unknown as readonly unknown[]);
    }
  }, [activeConversation?.message_groups, setChatHistory]);

  // Nav blocker
  const setStreamingBlockNav = useNavBlockerStore((s) => s.setStreamingBlockNav);
  useEffect(() => {
    setStreamingBlockNav(data.streaming.isStreamingNow, 'prompt');
  }, [data.streaming.isStreamingNow, setStreamingBlockNav]);

  // Send handler
  const handleSend = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      state.setIsMentioningEveryone(false);
      state.setSelectedUsers([]);
      const userMsg: Record<string, unknown> = {
        id: crypto.randomUUID(), role: 'user', content: question, created_at: new Date().toISOString(),
      };
      setChatHistoryState((prev) => [...(prev ?? []), userMsg]);
      chatInputRef.current?.reset?.();
      if (socketClient) {
        try {
          socketClient.emit('chat_predict', {
            question,
            conversation_uuid: activeConversation?.uuid,
            project_id: String(projectId ?? ''),
            participant_id: (activeParticipant as Record<string, unknown>)?.id as string | number | undefined,
          });
        } catch { /* Socket error handled elsewhere */ }
      }
      if (activeConversation?.uuid) data.streaming.setStreamingInfo(userMsg.id as string);
      if (!activeConversation?.uuid) {
        await lifecycle.createConversation({ name: question.slice(0, 50) || 'New Chat', isPrivate: true });
      }
    },
    [socketClient, state, activeConversation, data.streaming, lifecycle, projectId, activeParticipant],
  );

  // Regenerate handler
  const handleRegenerate = useCallback(
    (messageId: string) => { data.streaming.setStreamingInfo(messageId); },
    [data.streaming],
  );

  // Copy handler
  const handleCopy = useCallback(
    (message: ChatMessage) => { navigator.clipboard.writeText(message.content || '').catch(() => {}); },
    [],
  );

  // Delete handler
  const handleDeleteAnswer = useCallback(
    async (messageId: string) => { await onDeleteAnswer?.(messageId); },
    [onDeleteAnswer],
  );

  // Clear chat handler (stable via refs)
  const readAloudRef = useRef(readAloud);
  useEffect(() => { readAloudRef.current = readAloud; }, [readAloud]);
  const handleClear = useCallback(() => {
    readAloudRef.current.stop();
    if (activeConversation?.id) lifecycle.deleteConversation({ id: activeConversation.id });
    setChatHistoryState([]);
    streamingRef.current.clearConversationStreamingInfo();
  }, [activeConversation?.id, lifecycle]);

  // Imperative handle (stable refs)
  const handleClearRef = useRef(handleClear);
  useEffect(() => { handleClearRef.current = handleClear; }, [handleClear]);
  const streamingRef = useRef(data.streaming);
  useEffect(() => { streamingRef.current = data.streaming; }, [data.streaming]);

  useImperativeHandle(
    chatInputRef as unknown as React.Ref<ChatBoxHandle>,
    () => ({
      onClear: () => { handleClearRef.current(); },
      mentionUser: (c) => { chatInputRef.current?.setValue?.(`@${c} `); },
      stopAll: () => { streamingRef.current.stopStreaming(); },
    }),
    [],
  );

  // Early return
  if (hidden) return null;

  const messages = data.messageList.messages;
  const isStreaming = data.streaming.isStreamingNow || data.messageList.isStreamingFromHistory;

  return (
    <Box sx={{ display: hidden ? 'none' : 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <Box sx={{ flex: 1, overflow: 'auto', px: 2 }}>
        <ChatMessageList
          chatHistory={messages} isStreaming={isStreaming} userId={userId ?? ''}
          onCopyToClipboard={handleCopy} onDeleteAnswer={handleDeleteAnswer}
          onRegenerateAnswer={handleRegenerate} autoSpeak={false}
          speakingMessageId={
            readAloud.speakingMessageId !== null && readAloud.speakingMessageId !== undefined
              ? String(readAloud.speakingMessageId) : undefined as string | undefined
          }
          speakingSegments={readAloud.speakingSegments ?? undefined}
          spokenRange={
            readAloud.spokenRange !== null && readAloud.spokenRange !== undefined
              ? { start: readAloud.spokenRange.start, end: readAloud.spokenRange.end }
              : undefined as { readonly start: number; readonly end: number } | undefined
          }
        />
      </Box>
      <Box sx={{ p: 1 }}>
        <NewChatInput
          ref={chatInputRef}
          conversationId={activeConversation?.id !== undefined ? String(activeConversation.id) : undefined}
          state={{ isLoading: !!isLoadingConversation, isStreaming, disabledSend: !chatInputRef.current || !!isStreaming, isCreatingConversation: data.lifecycle.isCreating }}
          content={{ placeholder: 'Type a message...', clearInputAfterSubmit: true }}
          callbacks={{ onSend: handleSend, onStopGeneration: data.streaming.stopStreaming }}
          agentEditor={{
            activeParticipant: undefined, activeParticipantDetails: undefined,
            isAgentsPage: isAgentsPage ?? false, disableSwitchingParticipant: false,
            selectSavedOrDefaultModel: data.selectSavedOrDefaultModel,
            onShowParticipantsList: () => state.setShowRecommendationList(!state.showRecommendationList),
            selectedVersionId: undefined, onSelectVersion: () => {}, variables: [], onChangeVariables: () => {},
            onShowAgentEditor: () => {}, onShowPipelineEditor: () => {},
            onCloseAgentEditor: () => {}, onClosePipelineEditor: () => {},
          }}
          mentions={undefined}
          voice={{ isSpeakingMode: state.isSpeakingMode, onSpeakingModeToggle: () => state.setIsSpeakingMode(!state.isSpeakingMode), isTTSPlaying: readAloud.isPlaying }}
          slots={{
            attachmentButton: <AttachmentButton disableAttachments={false} attachments={[]} onAttachFiles={() => {}} />,
            internalToolsConfig: <ChatInternalToolsConfigButton />,
            voiceButton: <VoiceButton disabled={false} onRecordingChange={() => {}} />,
          }}
          refs={{}}
        />
        {state.showRecommendationList && (
          <Box sx={{ mt: 1 }}>
            <RecommendationList
              onSelectParticipant={(p: unknown) => { onChangeParticipant?.(p); state.setShowRecommendationList(false); }}
              existingParticipants={activeConversation?.participants ?? []}
              onClose={() => state.setShowRecommendationList(false)}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
});

const ChatBox = memo(ChatBoxInner);
ChatBox.displayName = 'ChatBox';

export default ChatBox;
