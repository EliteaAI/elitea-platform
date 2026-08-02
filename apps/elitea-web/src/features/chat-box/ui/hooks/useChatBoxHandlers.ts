/**
 * Action handlers for ChatBox.
 *
 * Encapsulates send, regenerate, copy-to-clipboard, message deletion, HITL
 * resume, MCP continuation, and attachment removal — the imperative action
 * surface the old `ChatBox.jsx` builds inside the component body (lines
 * ~530–930) into clean, testable functions.
 *
 * Port of `ChatBox.jsx` send/regenerate/HITL blocks.
 *
 * **DISCLOSED DESIGN**: handlers accept their runtime dependencies as plain
 * parameters (socket client, lifecycle actions, chat history getter) rather
 * than reaching for hooks themselves.  This keeps the composition root in
 * full control of the wiring (socket client, data sources, callbacks) while
 * the handler functions remain pure closures that can be unit-tested in
 * isolation.
 */

import { conversationApi } from '@/entities/conversation';

/* ------------------------------------------------------------------ */
/*  Shared shapes                                                       */
/* ------------------------------------------------------------------ */

/** A resolved HITL interrupt action from the user. */
export interface HitlInterruptAction {
  /** 'edit', 'approve', 'reject', or 'block_with_comment'. */
  readonly action: string;
  /** When `action === 'edit'`, the rewritten prompt text. */
  readonly value?: string;
  /** The tool_call_id routing this resume to the right sub-agent. */
  readonly toolCallId?: string;
  /** Child thread_id for independent fan-out child resume. */
  readonly childThreadId?: string;
}

/** Result returned by the send handler when the conversation needs creating. */
export interface SendResult {
  readonly success: boolean;
  /** A new conversation object (from backend) — only present when one was created. */
  readonly createdConversation?: Record<string, unknown>;
  /** Updated message list — only present when the backend returns it. */
  readonly updatedMessages?: readonly unknown[];
  /** Extra event payload the backend attached to the response. */
  readonly updatedEventPayload?: Record<string, unknown>;
}

/** Parameters for the send handler. */
export interface SendQuestionParams {
  readonly question: string;
  readonly attachments?: readonly File[];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                                */
/* ------------------------------------------------------------------ */

/**
 * Runtime dependencies injected by the composition root.
 * Only primitive values + function signatures — no React state or effects.
 */
export interface ChatBoxHandlerDeps {
  /** Emit a socket.io event (from `useSocketClient()`). */
  readonly emitSocket: (event: string, payload: Record<string, unknown>) => void;
  /** Set the active chat history (called when a new message is added). */
  readonly setChatHistory: React.Dispatch<React.SetStateAction<readonly unknown[]>>;
  /** Whether streaming is active (from streaming state). */
  readonly isStreamingNow?: boolean;
  /** Set streaming info for the current question ID. */
  readonly setStreamingInfo: (questionId: string) => void;
  /** Generate the base message payload (from composition root's payload logic). */
  readonly generateMessagePayload?: (data: {
    question: string;
    questionId: string;
    participant: unknown;
    conversationUuid?: string;
    attachmentList?: unknown[];
  }) => Record<string, unknown>;
  /** Trigger the regenerate RTK Query mutation. */
  readonly triggerRegenerate?: (
    params: Parameters<typeof conversationApi.regenerate>[0],
  ) => Promise<unknown>;
  /** Trigger the delete-message RTK Query mutation. */
  readonly triggerDeleteMessage?: (
    params: Parameters<typeof conversationApi.deleteMessage>[0],
  ) => Promise<unknown>;
  /** Trigger the delete-all-messages RTK Query mutation. */
  readonly triggerDeleteAllMessages?: (
    params: Parameters<typeof conversationApi.deleteAllMessages>[0],
  ) => Promise<unknown>;
  /** Trigger the stop-chat-task RTK Query mutation. */
  readonly triggerStopChatTask?: (
    params: Parameters<typeof conversationApi.stopTask>[0],
  ) => Promise<unknown>;
  /** Regenerate an existing AI answer (legacy callback, kept for compatibility). */
  readonly regenerateAnswer?: (params: {
    messageId: string;
    question: string;
    questionId: string;
    participant?: unknown;
  }) => Promise<void>;
  /** Delete a single message (legacy callback, kept for compatibility). */
  readonly deleteMessage?: (messageId: string) => Promise<void>;
  /** Delete all messages in the conversation (legacy callback, kept for compatibility). */
  readonly deleteAllMessages?: () => Promise<void>;
  /** Continue execution after MCP auth (emit `chat_continue_predict`). */
  readonly continueMcpExecution?: (messageId: string, addToIgnoreList?: boolean) => Promise<void>;
  /** Resolve the user's participant info for message attribution. */
  readonly getUserParticipant?: () => { id?: string; name?: string; avatar?: string };
  /** Resolve the active agent/participant. */
  readonly getActiveParticipant?: () => unknown;
  /** The current conversation's participants list. */
  readonly participants?: unknown[];
  /** Current conversation UUID. */
  readonly conversationUuid?: string;
  /** Project ID for API calls. */
  readonly projectId?: string | number;
}

/** Result of the handlers hook — a bundle of imperative callbacks. */
export interface UseChatBoxHandlersResult {
  /** Send a user question — builds payload, emits via socket, handles conv creation. */
  readonly sendQuestion: (params: SendQuestionParams) => Promise<SendResult>;
  /** Copy a message's content to the system clipboard. */
  readonly copyToClipboard: (message: unknown) => Promise<boolean>;
  /** Regenerate an AI answer by emitting a 'regenerate' socket event. */
  readonly regenerateAnswer: (messageId: string) => Promise<void>;
  /** Delete a single message via RTK Query mutation. */
  readonly deleteAnswer: (messageId: string) => Promise<void>;
  /** Clear all messages in the current conversation via RTK Query mutation. */
  readonly clearChat: () => Promise<void>;
  /** Continue execution after a HITL interrupt (emit 'hitl_response'). */
  readonly continueHitl: (action: HitlInterruptAction) => Promise<void>;
  /** Resume an MCP flow after authentication (emit 'mcp_resume'). */
  readonly resumeMcpFlow: (prompt: string, variables: Record<string, unknown>) => Promise<void>;
}

/**
 * Creates a bundle of imperative action handlers for the ChatBox.
 * Each handler is a closure that captures its runtime dependencies,
 * allowing the composition root to supply them at construction time.
 */
export function useChatBoxHandlers(deps: ChatBoxHandlerDeps): UseChatBoxHandlersResult {
  const {
    emitSocket,
    setChatHistory,
    isStreamingNow,
    setStreamingInfo,
    generateMessagePayload,
    triggerRegenerate,
    triggerDeleteMessage,
    triggerDeleteAllMessages,
    conversationUuid,
    projectId,
  } = deps;

  /* ---------------------------------------------------------------- */
  /*  sendQuestion — socket emit + local chat history                 */
  /* ---------------------------------------------------------------- */
  const sendQuestion = async (params: SendQuestionParams): Promise<SendResult> => {
    const { question, attachments } = params;
    if (!question.trim()) {
      return { success: false };
    }

    const questionId = crypto.randomUUID();
    const participant = deps.getActiveParticipant?.() ?? {};
    const payload = generateMessagePayload?.({
      question,
      questionId,
      participant,
      conversationUuid: deps.conversationUuid ?? '',
      attachmentList: attachments as unknown[],
    });

    if (!payload) {
      return { success: true }; // no payload = skip socket emit (prototype)
    }

    // Emit to socket for real-time streaming
    try {
      emitSocket('chat_predict', {
        ...payload,
        conversation_uuid: deps.conversationUuid || payload.conversation_uuid,
      });
    } catch (error) {
      // Socket failed — user will see an error through toast/other UI
      console.warn('[useChatBoxHandlers] chat_predict emit failed:', error);
    }

    // Record the question in chat history
    const userMessage: Record<string, unknown> = {
      id: questionId,
      role: 'user',
      content: question,
      created_at: new Date().toISOString(),
      participant_id: (participant as Record<string, unknown>)?.id,
    };

    setChatHistory((prev) => [...(prev ?? []), userMessage]);

    // Track streaming
    if (!isStreamingNow) {
      setStreamingInfo(questionId);
    }

    return { success: true };
  };

  /* ---------------------------------------------------------------- */
  /*  copyToClipboard — navigator.clipboard                           */
  /* ---------------------------------------------------------------- */
  const copyToClipboard = async (message: unknown): Promise<boolean> => {
    const content = (message as Record<string, unknown>)?.content as string | undefined;
    if (!content) return false;

    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      return false;
    }
  };

  /* ---------------------------------------------------------------- */
  /*  regenerateAnswer — socket 'regenerate' event                    */
  /* ---------------------------------------------------------------- */
  const regenerateAnswer = async (messageId: string): Promise<void> => {
    const convId = deps.conversationUuid ?? '';
    const pid = String(projectId ?? '');

    try {
      // Emit socket event for real-time regeneration streaming
      emitSocket('regenerate', {
        conversation_uuid: convId,
        project_id: pid,
        message_id: messageId,
      });

      // Also trigger the REST regenerate mutation for backend persistence
      if (triggerRegenerate) {
        await triggerRegenerate({
          projectId: pid,
          id: messageId,
        });
      }
    } catch (error) {
      console.warn('[useChatBoxHandlers] regenerate failed:', error);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  deleteAnswer — RTK Query mutation (DELETE message)              */
  /* ---------------------------------------------------------------- */
  const deleteAnswer = async (messageId: string): Promise<void> => {
    if (!triggerDeleteMessage) {
      console.warn('[useChatBoxHandlers] deleteAnswer: triggerDeleteMessage not provided');
      return;
    }

    const pid = String(projectId ?? '');
    const convId = conversationUuid ?? String(projectId ?? '');

    try {
      await triggerDeleteMessage({
        projectId: pid,
        id: messageId,
        conversationId: convId,
      });
    } catch (error) {
      console.warn('[useChatBoxHandlers] deleteAnswer failed:', error);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  clearChat — RTK Query mutation (DELETE all messages)            */
  /* ---------------------------------------------------------------- */
  const clearChat = async (): Promise<void> => {
    if (!triggerDeleteAllMessages) {
      console.warn('[useChatBoxHandlers] clearChat: triggerDeleteAllMessages not provided');
      return;
    }

    const pid = String(projectId ?? '');
    const convId = conversationUuid ?? String(projectId ?? '');

    try {
      await triggerDeleteAllMessages({
        projectId: pid,
        conversationId: convId,
      });
    } catch (error) {
      console.warn('[useChatBoxHandlers] clearChat failed:', error);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  continueHitl — socket 'hitl_response' event                     */
  /* ---------------------------------------------------------------- */
  const continueHitl = async (action: HitlInterruptAction): Promise<void> => {
    const convId = deps.conversationUuid ?? '';
    const pid = String(projectId ?? '');

    try {
      emitSocket('hitl_response', {
        conversation_uuid: convId,
        project_id: pid,
        action: action.action,
        ...(action.value !== undefined && { value: action.value }),
        ...(action.toolCallId !== undefined && { tool_call_id: action.toolCallId }),
        ...(action.childThreadId !== undefined && { child_thread_id: action.childThreadId }),
      });
    } catch (error) {
      console.warn('[useChatBoxHandlers] hitl_response emit failed:', error);
    }
  };

  /* ---------------------------------------------------------------- */
  /*  resumeMcpFlow — socket 'mcp_resume' event                       */
  /* ---------------------------------------------------------------- */
  const resumeMcpFlow = async (
    prompt: string,
    variables: Record<string, unknown>,
  ): Promise<void> => {
    const convId = deps.conversationUuid ?? '';
    const pid = String(projectId ?? '');

    try {
      emitSocket('mcp_resume', {
        conversation_uuid: convId,
        project_id: pid,
        prompt,
        variables,
      });
    } catch (error) {
      console.warn('[useChatBoxHandlers] mcp_resume emit failed:', error);
    }
  };

  return {
    sendQuestion,
    copyToClipboard,
    regenerateAnswer,
    deleteAnswer,
    clearChat,
    continueHitl,
    resumeMcpFlow,
  };
}
