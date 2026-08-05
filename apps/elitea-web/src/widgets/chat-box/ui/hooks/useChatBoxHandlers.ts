/**
 * Action handlers for ChatBox — send, regenerate, copy, delete, HITL resume,
 * MCP continuation, token-limit continuation. Port of `ChatBox.jsx`'s
 * `onPredictStream`/`onCopyToClipboard`/`onRegenerateAnswer`/
 * `continueMcpExecution`/`onContinueTokenLimitExecution`/`onHitlResume`/
 * `onClickClearChat` (lines ~530-1508), as closures over caller-injected deps.
 * Dependency-injection types + pure helpers live in `./useChatBoxHandlers.helpers`
 * (split out to stay under the §3.5 file-length budget).
 *
 * DISCLOSED GAPS vs. baseline: payloads carry only fields this hook's deps
 * can supply — baseline's `generateMessagePayload`/
 * `generateApplicationStreamingPayload`/`getRegeneratePayload` (llm_settings
 * by participant type) and `McpAuthHelpers.getAllTokens()`/
 * `getServersWithoutTokens()` (`mcp_tokens`/`ignored_mcp_servers`, deep paths
 * in `features/mcps/lib/` not on that slice's public barrel — importing them
 * would violate `no-deep-slice-import-cross-slice`) aren't ported; same gaps
 * `useToolkitChat.types.ts` already records. `user_declined_mcp_servers`
 * (session-only) IS ported. `continueHitl`'s Track-1 "parallel fan-out"
 * decision-batching isn't ported (each decision resumes independently);
 * Track-2's independent fan-out-child resume IS (routes on `childThreadId`).
 */

import type { conversationApi } from '@/entities/conversation';
import type { ChatMessage } from '@/features/chat-messages';
import { ToolActionStatus } from '@/shared/lib/chat';

import {
  buildChatContinuePayload,
  buildDeclinedServersList,
  buildDefaultMessagePayload,
  buildOptimisticUserMessage,
  buildRegeneratePayload,
  buildSendResult,
  extractCopyableContent,
  findActionRequiredToolAction,
  findQuestionForAnswer,
  findQuestionText,
  maybeSetStreamingInfo,
  readServerUrl,
  regeneratingPatch,
  resolveConversationForSend,
  resolveParticipantId,
  resolveUploadConversationId,
  toProjectIdString,
  trackMcpAuthDecision,
  uploadPendingAttachments,
  UPLOAD_FAILED,
} from './useChatBoxHandlers.helpers';
import type {
  ChatBoxHandlerDeps,
  HitlInterruptAction,
  SendQuestionParams,
  SendResult,
  ToolActionLike,
  UpdatedMessageItem,
  UseChatBoxHandlersResult,
} from './useChatBoxHandlers.helpers';

/*
 * [#71] `UpdatedMessageItem` and `UploadedAttachmentOutcome` were dropped from
 * this re-export list. The issue's triage flagged `UploadedAttachmentOutcome`
 * as appearing twice — an `interface` in `useChatBoxHandlers.helpers.ts:37` and
 * a `type` here — and asked whether the two shapes agree before deleting
 * either. They are not two shapes: there is one declaration, in the helpers
 * module, and this block merely re-exported it, which is why knip listed it
 * under both files. Nothing to reconcile, no merge artifact.
 *
 * `UploadedAttachmentOutcome` is internal to the helpers module (it only names
 * the element type of `ChatBoxHandlerDeps.uploadAttachments`'s resolved value,
 * and a caller builds that object literal structurally), so it is no longer
 * exported there either. `UpdatedMessageItem` is still exported by the helpers
 * module — `buildRegeneratePayload` takes it — it just has no consumer for the
 * re-export.
 */
export type {
  ChatBoxHandlerDeps,
  HitlInterruptAction,
  SendQuestionParams,
  SendResult,
  UseChatBoxHandlersResult,
} from './useChatBoxHandlers.helpers';

/** Creates a bundle of imperative action handlers for the ChatBox, each a closure over caller-injected `deps`. */
export function useChatBoxHandlers(deps: ChatBoxHandlerDeps): UseChatBoxHandlersResult {
  const { emitSocket, setChatHistory, isStreamingNow, setStreamingInfo, generateMessagePayload, triggerRegenerate, triggerDeleteMessage, triggerDeleteAllMessages, conversationUuid, conversationId, projectId } = deps;
  const sendQuestion = async (params: SendQuestionParams): Promise<SendResult> => {
    const { question, attachments, isSendingToUser, userIds } = params;
    if (!question.trim()) return { success: false };
    // Track a still-pending MCP auth as session-declined before sending — baseline: `ChatBox.jsx:793-812`.
    const lastMessage = deps.chatHistory[deps.chatHistory.length - 1];
    const pendingAuth = findActionRequiredToolAction(lastMessage);
    trackMcpAuthDecision(deps.sessionDeclinedMcpServersRef, pendingAuth, readServerUrl(pendingAuth), true);
    const questionId = crypto.randomUUID();
    const participant = deps.getActiveParticipant?.() ?? null;
    const userParticipant = deps.getUserParticipant?.();
    const participantId = resolveParticipantId(participant);
    const { uuid: resolvedConversationUuid, createdConversation } = await resolveConversationForSend(deps, question);
    const uploadConversationId = resolveUploadConversationId(createdConversation, deps.conversationId);
    const attachmentList = await uploadPendingAttachments(deps, attachments, uploadConversationId);
    if (attachmentList === UPLOAD_FAILED) return { success: false };
    const payload = (generateMessagePayload ?? buildDefaultMessagePayload)({ question, questionId, participant, conversationUuid: resolvedConversationUuid, attachmentList, isSendingToUser, userIds });
    setChatHistory((prev) => [...prev, buildOptimisticUserMessage(questionId, question, userParticipant, participantId)]);
    if (!isStreamingNow) setStreamingInfo(questionId);
    // Only emit once a conversation UUID actually exists — baseline: `ChatBox.jsx:928` `if (conversationUuid) { emit(...) }`.
    if (resolvedConversationUuid) {
      try {
        emitSocket('chat_predict', { ...payload, conversation_uuid: resolvedConversationUuid, project_id: toProjectIdString(projectId) });
      } catch (error) {
        console.warn('[useChatBoxHandlers] chat_predict emit failed:', error);
      }
    }
    return buildSendResult(createdConversation);
  };
  const copyToClipboard = async (message: ChatMessage): Promise<boolean> => {
    const content = message.exception ? JSON.stringify(message.exception) : extractCopyableContent(message);
    if (!content) return false;
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      return false;
    }
  };
  const regenerateAnswer = async (messageId: string, updatedItems?: readonly UpdatedMessageItem[]): Promise<void> => {
    if (!triggerRegenerate) {
      console.warn('[useChatBoxHandlers] regenerateAnswer: triggerRegenerate not provided');
      return;
    }
    const answer = deps.chatHistory.find((item) => item.id === messageId);
    const questionMessage = findQuestionForAnswer(deps.chatHistory, answer);
    let previousAnswer: ChatMessage | undefined;
    setChatHistory((prev) => {
      previousAnswer = prev.find((item) => item.id === messageId);
      return prev.map((item) => (item.id !== messageId ? item : regeneratingPatch(item)));
    });
    maybeSetStreamingInfo(setStreamingInfo, questionMessage?.id);
    const payload = buildRegeneratePayload(deps, messageId, questionMessage, updatedItems);
    try {
      await triggerRegenerate(payload as Parameters<typeof conversationApi.regenerate>[0]);
    } catch (error) {
      console.warn('[useChatBoxHandlers] regenerate failed:', error);
      if (previousAnswer) {
        const restored = previousAnswer;
        setChatHistory((prev) => prev.map((item) => (item.id !== messageId ? item : restored)));
      }
    }
  };
  const deleteAnswer = async (messageId: string): Promise<void> => {
    if (!triggerDeleteMessage) {
      console.warn('[useChatBoxHandlers] deleteAnswer: triggerDeleteMessage not provided');
      return;
    }
    const convId = conversationUuid ?? (conversationId !== undefined ? String(conversationId) : '');
    try {
      await triggerDeleteMessage({ projectId: toProjectIdString(projectId), id: messageId, conversationId: convId });
      setChatHistory((prev) => prev.filter((item) => item.id !== messageId));
    } catch (error) {
      console.warn('[useChatBoxHandlers] deleteAnswer failed:', error);
    }
  };
  // Messages-only delete — NEVER the whole conversation.
  const clearChat = async (): Promise<void> => {
    if (!triggerDeleteAllMessages) {
      console.warn('[useChatBoxHandlers] clearChat: triggerDeleteAllMessages not provided');
      return;
    }
    const convId = conversationUuid ?? (conversationId !== undefined ? String(conversationId) : '');
    try {
      await triggerDeleteAllMessages({ projectId: toProjectIdString(projectId), conversationId: convId });
      setChatHistory([]);
    } catch (error) {
      console.warn('[useChatBoxHandlers] clearChat failed:', error);
    }
  };
  // `applyHitlOptimisticUpdate`/`buildHitlPayload` extracted (from `continueHitl`) to keep it under the complexity budget.
  const applyHitlOptimisticUpdate = (messageId: string, action: HitlInterruptAction): void => {
    setChatHistory((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId) return msg;
        if (action.childThreadId && Array.isArray(msg.hitlInterrupts)) {
          const remaining = (msg.hitlInterrupts as unknown as readonly { tool_call_id?: string }[]).filter((entry) => entry.tool_call_id !== action.toolCallId);
          return { ...msg, hitlInterrupts: remaining, hitlInterrupt: remaining[0], isStreaming: true, isLoading: true };
        }
        return { ...msg, isLoading: true, isStreaming: true, exception: undefined, hitlInterrupt: undefined, hitlInterrupts: undefined };
      }),
    );
  };
  const buildHitlPayload = (message: ChatMessage, action: HitlInterruptAction): Record<string, unknown> => {
    const question = action.action === 'edit' ? (action.value ?? '') : action.action;
    const threadId = action.childThreadId || message.threadId;
    const base = buildChatContinuePayload(deps, { messageId: message.id, threadId, question });
    if (action.childThreadId) {
      return { ...base, hitl_resume: true, hitl_decisions: [{ thread_id: action.childThreadId, tool_call_id: action.toolCallId, action: action.action, value: action.value ?? '' }] };
    }
    const withValue = action.action === 'edit' || action.action === 'block_with_comment' ? { hitl_value: action.value ?? '' } : {};
    return { ...base, hitl_resume: true, hitl_action: action.action, ...withValue };
  };
  const continueHitl = (action: HitlInterruptAction): void => {
    const message = [...deps.chatHistory].reverse().find((item) => Boolean(item.hitlInterrupt) || Boolean(item.hitlInterrupts?.length));
    if (!message) return;
    const payload = buildHitlPayload(message, action);
    applyHitlOptimisticUpdate(message.id, action);
    setStreamingInfo(message.questionId ?? message.id);
    try {
      emitSocket('chat_continue_predict', payload);
    } catch (error) {
      console.warn('[useChatBoxHandlers] continueHitl emit failed:', error);
    }
  };
  const resumeMcpFlow = (messageId: string, addToIgnoreList = false): void => {
    const message = deps.chatHistory.find((item) => item.id === messageId);
    if (!message) return;
    const authRequiredAction = findActionRequiredToolAction(message);
    trackMcpAuthDecision(deps.sessionDeclinedMcpServersRef, authRequiredAction, readServerUrl(authRequiredAction), addToIgnoreList);
    const question = findQuestionText(deps.chatHistory, message) ?? 'Continue';
    const payload: Record<string, unknown> = {
      ...buildChatContinuePayload(deps, { messageId, threadId: message.threadId, question }),
      user_declined_mcp_servers: buildDeclinedServersList(deps.sessionDeclinedMcpServersRef),
    };
    setChatHistory((prev) =>
      prev.map((msg) =>
        msg.id !== messageId
          ? msg
          : { ...msg, isLoading: true, isStreaming: true, toolActions: ((msg.toolActions ?? []) as readonly ToolActionLike[]).filter((a) => a.status !== ToolActionStatus.actionRequired) as unknown as ChatMessage['toolActions'] },
      ),
    );
    setStreamingInfo(message.questionId ?? messageId);
    try {
      emitSocket('chat_continue_predict', payload);
    } catch (error) {
      console.warn('[useChatBoxHandlers] resumeMcpFlow emit failed:', error);
    }
  };
  const continueTokenLimit = (messageId: string): void => {
    const message = deps.chatHistory.find((item) => item.id === messageId);
    if (!message) return;
    const question = findQuestionText(deps.chatHistory, message) ?? 'Continue';
    const payload = buildChatContinuePayload(deps, { messageId, threadId: message.threadId, question });
    setChatHistory((prev) => prev.map((msg) => (msg.id !== messageId ? msg : { ...msg, isLoading: true, isStreaming: true })));
    setStreamingInfo(message.questionId ?? messageId);
    try {
      emitSocket('chat_continue_predict', payload);
    } catch (error) {
      console.warn('[useChatBoxHandlers] continueTokenLimit emit failed:', error);
    }
  };
  return { sendQuestion, copyToClipboard, regenerateAnswer, deleteAnswer, clearChat, continueHitl, resumeMcpFlow, continueTokenLimit };
}
