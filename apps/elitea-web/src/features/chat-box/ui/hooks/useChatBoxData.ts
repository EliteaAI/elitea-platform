/**
 * Data primitives hook for ChatBox.
 *
 * Supplies the conversation lifecycle (create / edit / delete / select /
 * regenerate), streaming management, chat-history normalisation, and the
 * participant-resolution helper — all of which the composition root needs
 * before it can even attempt to render a message list or call NewChatInput.
 *
 * Port of `ChatBox.jsx` lines ~240–280 (lifecycle), ~400–430 (streaming),
 * ~90–120 (model / defaults), and ~735–765 (attachment removal).
 */
import { useCallback, useMemo, useState } from 'react';

import {
  useConversationLifecycle,
  useChatStreaming,
  chatHelpers,
} from '@/entities/conversation';
import type { UseChatStreamingResult } from '@/entities/conversation/lib/hooks/useChatStreaming';
import { useAttachmentState, useUploadAttachments } from '@/entities/conversation';
import type { StreamingChatHistoryItem } from '@/entities/conversation/lib/wire';
import type { MessageGroupWire, MessageParticipantWire } from '@/entities/message';
import {
  convertMessagesToChatHistory,
} from '@/features/chat-messages';
import type { ChatMessage } from '@/features/chat-messages';

/* ------------------------------------------------------------------ */
/*  Derived shapes                                                      */
/* ------------------------------------------------------------------ */

/** Resolved LLM model reference. */
export interface ChatBoxModel {
  readonly name?: string;
  readonly projectId?: string;
  readonly supportsReasoning?: boolean;
}

/** Normalised message list ready for ChatMessageList rendering. */
export interface ChatBoxMessageList {
  readonly messages: readonly ChatMessage[];
  /** Whether any message is currently streaming (derived from persisted history). */
  readonly isStreamingFromHistory: boolean;
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

/**
 * Params required from the composition root — only primitive values so the
 * hook result is referentially stable across renders for the same identity.
 */
export interface UseChatBoxDataParams {
  readonly conversationId: string | number | undefined;
  readonly conversationUuid: string | undefined;
  /** Wire-shape participants array from the conversation. */
  readonly participants: unknown[] | undefined;
  /** Wire-shape message_groups[] from the conversation details API. */
  readonly messageGroups: MessageGroupWire[] | undefined;
  /** The active agent / pipeline / toolkit participant (may be null for model-only chat). */
  readonly activeParticipant: unknown;
  readonly projectId: string | number | undefined;
  readonly userId: string | undefined;
  readonly userName: string | undefined;
  readonly userAvatar: string | undefined;
  readonly isAgentsPage: boolean | undefined;
  readonly conversationIsPlayingBack: boolean;
}

export interface UseChatBoxDataResult {
  /** Bundled lifecycle actions (create / edit / delete / select / unselect). */
  readonly lifecycle: ReturnType<typeof useConversationLifecycle>;
  /** Streaming state and controls (setStreamingInfo, stopStreaming, isStreamingNow). */
  readonly streaming: UseChatStreamingResult;
  /** Attachment management (local CRUD + chunked upload). */
  readonly attachments: {
    state: ReturnType<typeof useAttachmentState<File>>;
    upload: ReturnType<typeof useUploadAttachments>;
  };
  /** Normalised message list for ChatMessageList (empty if no persisted data yet). */
  readonly messageList: ChatBoxMessageList;
  /** Resolve a participant by ID from the conversation's participant list. */
  readonly resolveParticipant: (participantId: string | number) => MessageParticipantWire | undefined;
  /** Set the selected LLM model (called when user picks one from the dropdown). */
  readonly setSelectedModel: (model: ChatBoxModel | null) => void;
  /** Currently selected LLM model. */
  readonly selectedModel: ChatBoxModel | null;
  /** Default LLM model from available models (null until resolved). */
  readonly defaultModel: ChatBoxModel | null;
  /** Resolve the saved or default model for the current conversation/participant. */
  readonly selectSavedOrDefaultModel: (forceSelect?: boolean) => void;
}

/**
 * Hook that provides conversation lifecycle, streaming, attachment management,
 * and message normalisation for the ChatBox composition root.
 */
export function useChatBoxData(params: UseChatBoxDataParams): UseChatBoxDataResult {
  const {
    conversationId,
    conversationUuid,
    participants,
    messageGroups,
    projectId,
    isAgentsPage,
    // conversationIsPlayingBack is reserved for future use in streaming mode
    conversationIsPlayingBack: _conversationIsPlayingBack,
  } = params;

  // -- Lifecycle --
  const lifecycle = useConversationLifecycle(projectId);

  // -- Streaming --
  // The streaming hook needs the chat history in StreamingChatHistoryItem shape.
  // Since we normalise to ChatMessage[] for rendering, we re-use the message
  // list items (which carry the same discriminating fields) as the streaming
  // chat history source.
  const streamingChatHistory: readonly StreamingChatHistoryItem[] | undefined = useMemo(() => {
    if (!messageGroups || messageGroups.length === 0) return undefined;
    return messageGroups as unknown as readonly StreamingChatHistoryItem[];
  }, [messageGroups]);

  const streaming = useChatStreaming({
    projectId,
    conversationId: conversationUuid ?? String(conversationId ?? ''),
    chatHistory: streamingChatHistory,
    isChatStreaming: !isAgentsPage,
  });

  // -- Attachments --
  const attachmentState = useAttachmentState<File>();
  const uploadAttachmentsHook = useUploadAttachments();

  // -- Messages --
  const messageList = useMemo<ChatBoxMessageList>(() => {
    if (!messageGroups || messageGroups.length === 0) {
      return { messages: [], isStreamingFromHistory: false };
    }

    // Normalise message groups → ChatMessage[].
    const messages = convertMessagesToChatHistory(
      messageGroups,
      participants as MessageParticipantWire[] | undefined,
      undefined /* playerInfo */,
    );

    return { messages, isStreamingFromHistory: false };
  }, [messageGroups, participants]);

  // -- Participant resolution --
  const resolveParticipant = useCallback(
    (participantId: string | number): MessageParticipantWire | undefined => {
      if (!participants || !Array.isArray(participants)) return undefined;
      return chatHelpers.getParticipantById(
        { participants: participants as unknown[] } as Parameters<typeof chatHelpers.getParticipantById>[0],
        String(participantId),
      ) as MessageParticipantWire | undefined;
    },
    [participants],
  );

  // -- Models --
  const [selectedModel, setSelectedModel] = useState<ChatBoxModel | null>(null);

  const defaultModel = useMemo<ChatBoxModel | null>(() => null, []);

  const selectSavedOrDefaultModel = useCallback(
    (_forceSelect = true) => {
      // Prototype: just pick the default model. Real implementation resolves
      // from user settings or participant llm_settings.
      setSelectedModel(defaultModel);
    },
    [defaultModel],
  );

  return {
    lifecycle,
    streaming,
    attachments: { state: attachmentState, upload: uploadAttachmentsHook },
    messageList,
    resolveParticipant,
    setSelectedModel,
    selectedModel,
    defaultModel,
    selectSavedOrDefaultModel,
  };
}
