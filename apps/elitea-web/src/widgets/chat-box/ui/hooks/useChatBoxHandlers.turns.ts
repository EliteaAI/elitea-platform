/** Focused factories for ordinary ChatBox turn actions. */
import { conversationApi } from "@/entities/conversation";
import type { ChatMessage } from "@/features/chat-messages";
import { t } from "@/shared/i18n";
import { ROLES } from "@/shared/lib/enums";

import {
  buildDefaultMessagePayload,
  buildFailedTurnMessage,
  buildOptimisticUserMessage,
  buildRegeneratePayload,
  buildSendResult,
  findActionRequiredToolAction,
  findQuestionForAnswer,
  maybeSetStreamingInfo,
  NO_STREAM_TRANSPORT,
  readServerUrl,
  regeneratingPatch,
  resolveConversationForSend,
  resolveParticipantId,
  resolveUploadConversationId,
  toProjectIdString,
  trackMcpAuthDecision,
  tryEmit,
  uploadPendingAttachments,
  UPLOAD_FAILED,
} from "./useChatBoxHandlers.helpers";
import type {
  ChatBoxHandlerDeps,
  SendQuestionParams,
  SendResult,
  UpdatedMessageItem,
} from "./useChatBoxHandlers.helpers";

/**
 * The history a turn NO TRANSPORT ACCEPTED leaves behind.
 *
 * THE QUESTION STAYS. `sendQuestion` has already cleared the composer by the
 * time this runs, so the optimistic bubble is the only copy of what the person
 * typed, and `buildFailedTurnMessage` anchors the reason to it through
 * `questionId` — an error on its own no longer says which message failed.
 * Dropping it unconditionally is what made journeys 8, 9 and 12 read an empty
 * `chat-message-list`: the E2E stack serves `vite_socket_server: ""` and has no
 * runtime plane, so EVERY turn there reaches this branch.
 *
 * It is dropped in exactly one case: another user message already carries the
 * same text. That is what re-sending a question the server persisted before the
 * transport dropped produces — the refusal ("a previous agent turn is still
 * being recovered") arrives with the original already on screen, and a second
 * identical bubble is noise rather than information.
 *
 * A previous failure for the SAME question is always replaced, so a retry that
 * reuses `questionId` does not stack error bubbles.
 */
function historyAfterFailedTurn(
  previous: readonly ChatMessage[],
  questionId: string,
  question: string,
  failure: string,
): readonly ChatMessage[] {
  const alreadyOnScreen = previous.some(
    (message) =>
      message.id !== questionId &&
      message.role === ROLES.User &&
      message.content === question,
  );
  return [
    ...previous.filter(
      (message) =>
        message.id !== `${questionId}-error` &&
        !(alreadyOnScreen && message.id === questionId),
    ),
    buildFailedTurnMessage(questionId, failure),
  ];
}

export const undeliveredText = (): string =>
  t(
    "widgets.chatBox.turnNotDelivered",
    "The message was not sent: no chat connection is available. Reload the page and try again.",
  );

async function deliverTurn(
  deps: ChatBoxHandlerDeps,
  params: {
    readonly conversationUuid: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<string | undefined> {
  const outcome = deps.startStreamedExecution
    ? await deps.startStreamedExecution(params)
    : NO_STREAM_TRANSPORT;
  if (outcome.started) return undefined;
  if (outcome.reason === "rejected") return outcome.message;
  const emitted = tryEmit(
    () =>
      deps.emitSocket("chat_predict", {
        ...params.payload,
        conversation_uuid: params.conversationUuid,
        project_id: toProjectIdString(deps.projectId),
      }),
    "chat_predict",
  );
  return emitted ? undefined : undeliveredText();
}

export function createSendQuestion(
  deps: ChatBoxHandlerDeps,
): (params: SendQuestionParams) => Promise<SendResult> {
  return async ({ question, attachments, isSendingToUser, userIds }) => {
    if (!question.trim()) return { success: false };
    const lastMessage = deps.chatHistory[deps.chatHistory.length - 1];
    const pendingAuth = findActionRequiredToolAction(lastMessage);
    trackMcpAuthDecision(
      deps.sessionDeclinedMcpServersRef,
      pendingAuth,
      readServerUrl(pendingAuth),
      true,
    );
    const questionId = crypto.randomUUID();
    const participant = deps.getActiveParticipant?.() ?? null;
    const userParticipant = deps.getUserParticipant?.();
    const participantId = resolveParticipantId(participant);
    const { uuid: resolvedConversationUuid, createdConversation } =
      await resolveConversationForSend(deps, question);
    const uploadConversationId = resolveUploadConversationId(
      createdConversation,
      deps.conversationId,
    );
    const attachmentList = await uploadPendingAttachments(
      deps,
      attachments,
      uploadConversationId,
    );
    if (attachmentList === UPLOAD_FAILED) return { success: false };
    const payload = (
      deps.generateMessagePayload ?? buildDefaultMessagePayload
    )({
      question,
      questionId,
      participant,
      conversationUuid: resolvedConversationUuid,
      attachmentList,
      isSendingToUser,
      userIds,
    });
    deps.setChatHistory((prev) => [
      ...prev,
      buildOptimisticUserMessage(
        questionId,
        question,
        userParticipant,
        participantId,
      ),
    ]);
    if (!deps.isStreamingNow) deps.setStreamingInfo(questionId);
    const failure = resolvedConversationUuid
      ? await deliverTurn(deps, {
          conversationUuid: resolvedConversationUuid,
          payload,
        })
      : t(
          "widgets.chatBox.conversationNotCreated",
          "The message was not sent: this chat could not be created.",
        );
    if (failure !== undefined) {
      deps.setChatHistory((prev) =>
        historyAfterFailedTurn(prev, questionId, question, failure),
      );
      return { success: false };
    }
    return buildSendResult(createdConversation);
  };
}

function restoreAnswer(
  deps: ChatBoxHandlerDeps,
  messageId: string,
  answer: ChatMessage | undefined,
): void {
  if (!answer) return;
  deps.setChatHistory((prev) =>
    prev.map((item) => (item.id !== messageId ? item : answer)),
  );
}

export function createRegenerateAnswer(
  deps: ChatBoxHandlerDeps,
): (
  messageId: string,
  updatedItems?: readonly UpdatedMessageItem[],
) => Promise<void> {
  return async (messageId, updatedItems) => {
    if (!deps.regenerateStreamedExecution && !deps.triggerRegenerate) {
      console.warn(
        "[useChatBoxHandlers] regenerateAnswer: no regeneration transport provided",
      );
      return;
    }
    const answer = deps.chatHistory.find((item) => item.id === messageId);
    const questionMessage = findQuestionForAnswer(deps.chatHistory, answer);
    let previousAnswer: ChatMessage | undefined;
    deps.setChatHistory((prev) => {
      previousAnswer = prev.find((item) => item.id === messageId);
      return prev.map((item) =>
        item.id !== messageId ? item : regeneratingPatch(item),
      );
    });
    maybeSetStreamingInfo(deps.setStreamingInfo, questionMessage?.id);
    if (deps.regenerateStreamedExecution && questionMessage) {
      const outcome = await deps.regenerateStreamedExecution({
        messageId,
        questionId: questionMessage.id,
        question: questionMessage.content,
        ...(updatedItems !== undefined ? { updatedItems } : {}),
      });
      if (outcome.started) return;
    }
    if (!deps.triggerRegenerate) {
      restoreAnswer(deps, messageId, previousAnswer);
      return;
    }
    const payload = buildRegeneratePayload(
      deps,
      messageId,
      questionMessage,
      updatedItems,
    );
    try {
      await deps.triggerRegenerate(
        payload as Parameters<typeof conversationApi.regenerate>[0],
      );
    } catch (error) {
      console.warn("[useChatBoxHandlers] regenerate failed:", error);
      restoreAnswer(deps, messageId, previousAnswer);
    }
  };
}

export function createDeleteAnswer(
  deps: ChatBoxHandlerDeps,
): (messageId: string) => Promise<void> {
  return async (messageId) => {
    if (!deps.triggerDeleteMessage) {
      console.warn(
        "[useChatBoxHandlers] deleteAnswer: triggerDeleteMessage not provided",
      );
      return;
    }
    const conversationId =
      deps.conversationUuid ??
      (deps.conversationId !== undefined ? String(deps.conversationId) : "");
    try {
      const result = await deps.triggerDeleteMessage({
        projectId: toProjectIdString(deps.projectId),
        id: messageId,
        conversationId,
      });
      const removed = new Set<string>(
        result?.deleted && result.deleted.length > 0
          ? result.deleted.map(String)
          : [String(messageId)],
      );
      deps.setChatHistory((prev) =>
        prev.filter((item) => !removed.has(String(item.id))),
      );
    } catch (error) {
      console.warn("[useChatBoxHandlers] deleteAnswer failed:", error);
    }
  };
}

export function createClearChat(
  deps: ChatBoxHandlerDeps,
): () => Promise<void> {
  return async () => {
    if (!deps.triggerDeleteAllMessages) {
      console.warn(
        "[useChatBoxHandlers] clearChat: triggerDeleteAllMessages not provided",
      );
      return;
    }
    const conversationId =
      deps.conversationUuid ??
      (deps.conversationId !== undefined ? String(deps.conversationId) : "");
    try {
      await deps.triggerDeleteAllMessages({
        projectId: toProjectIdString(deps.projectId),
        conversationId,
      });
      deps.setChatHistory([]);
    } catch (error) {
      console.warn("[useChatBoxHandlers] clearChat failed:", error);
    }
  };
}
