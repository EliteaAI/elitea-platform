import { useCallback, useEffect, useState } from 'react';

import { ROLES } from '@/shared/lib/enums';

import { useChatSessionStore } from '../../model/chatSessionStore';
import type { StreamingChatHistoryItem } from '../wire';

/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useChatStreaming.js` (unit
 * C1) — pure Redux-derived local state (reads `currentStreamingInfo`), not a
 * socket hook. `projectId` is an explicit parameter (the baseline reads
 * `useSelectedProjectId()` off a global-store hook `entities/` has no legal
 * import path to — same N4 signature deviation `shared/lib/http-error.ts`'s
 * `buildErrorMessage` already documents for the identical reason).
 */

export interface UseChatStreamingParams {
  readonly projectId: string | number | undefined;
  readonly conversationId: string | number | undefined;
  readonly chatHistory: readonly StreamingChatHistoryItem[] | undefined;
  readonly onStopStreaming?: (message: StreamingChatHistoryItem) => (() => void) | undefined;
  readonly isChatStreaming?: boolean;
}

export interface UseChatStreamingResult {
  readonly setStreamingInfo: (questionId: string) => void;
  readonly clearConversationStreamingInfo: () => void;
  readonly setConversationStreamingInfo: (conversationUuid: string, questionId: string) => void;
  readonly stopStreaming: () => void;
  readonly isStreamingNow: boolean;
}

function isInFlight(item: StreamingChatHistoryItem): boolean {
  return Boolean(item.isStreaming || item.isLoading || item.isRegenerating);
}

function matchesQuestion(item: StreamingChatHistoryItem, questionId: string): boolean {
  return item.replyTo?.uuid === questionId || item.replyTo?.id === questionId || (item.role === ROLES.Assistant && item.question_id === questionId);
}

/** `useChatStreaming.js:64-96`'s `isChatStreaming === true` branch. */
function findByQuestionId(chatHistory: readonly StreamingChatHistoryItem[], questionId: string): { readonly streaming?: StreamingChatHistoryItem; readonly settled: boolean } {
  const streaming = chatHistory.find((item) => matchesQuestion(item, questionId) && isInFlight(item));
  if (streaming) return { streaming, settled: false };
  const settled = chatHistory.some((item) => matchesQuestion(item, questionId) && !isInFlight(item));
  return { settled };
}

export function useChatStreaming(params: UseChatStreamingParams): UseChatStreamingResult {
  const { projectId, conversationId, chatHistory, onStopStreaming, isChatStreaming = true } = params;
  const currentStreamingInfo = useChatSessionStore((state) => state.currentStreamingInfo);
  const setStreamingInfoAction = useChatSessionStore((state) => state.setStreamingInfo);
  const clearConversationStreamingInfoAction = useChatSessionStore((state) => state.clearConversationStreamingInfo);
  const [isStreamingNow, setIsStreamingNow] = useState(false);
  const [answerMessage, setAnswerMessage] = useState<StreamingChatHistoryItem | null>(null);
  const currentQuestionId = (projectId !== undefined && conversationId !== undefined && currentStreamingInfo[String(projectId)]?.[String(conversationId)]) || '';

  const setStreamingInfo = useCallback(
    (questionId: string) => {
      if (projectId === undefined || conversationId === undefined) return;
      setStreamingInfoAction(String(projectId), String(conversationId), questionId);
    },
    [projectId, conversationId, setStreamingInfoAction],
  );

  const setConversationStreamingInfo = useCallback(
    (conversationUuid: string, questionId: string) => {
      if (projectId === undefined) return;
      setStreamingInfoAction(String(projectId), conversationUuid, questionId);
    },
    [projectId, setStreamingInfoAction],
  );

  const clearConversationStreamingInfo = useCallback(() => {
    if (projectId === undefined || conversationId === undefined) return;
    clearConversationStreamingInfoAction(String(projectId), String(conversationId));
  }, [projectId, conversationId, clearConversationStreamingInfoAction]);

  const stopStreaming = useCallback(() => {
    if (answerMessage) onStopStreaming?.(answerMessage)?.();
    clearConversationStreamingInfo();
  }, [onStopStreaming, answerMessage, clearConversationStreamingInfo]);

  useEffect(() => {
    if (!chatHistory || chatHistory.length === 0) {
      setIsStreamingNow(false);
      setAnswerMessage(null);
      return;
    }

    if (!isChatStreaming) {
      const found = chatHistory.find(isInFlight);
      setIsStreamingNow(Boolean(found));
      setAnswerMessage(found ?? null);
      if (!found) clearConversationStreamingInfo();
      return;
    }

    if (!currentQuestionId) {
      setIsStreamingNow(false);
      setAnswerMessage(null);
      return;
    }

    const { streaming, settled } = findByQuestionId(chatHistory, currentQuestionId);
    if (streaming) {
      setIsStreamingNow(true);
      setAnswerMessage(streaming);
    } else if (settled) {
      setIsStreamingNow(false);
      setAnswerMessage(null);
      clearConversationStreamingInfo();
    }
    // oxlint-disable-next-line react/exhaustive-deps -- mirrors the baseline's own deliberately-scoped dependency list (`useChatStreaming.js:111`: `[currentQuestionId, chatHistory, chatHistory.length]`), not every closed-over value.
  }, [currentQuestionId, chatHistory, chatHistory?.length, isChatStreaming]);

  return { setStreamingInfo, clearConversationStreamingInfo, setConversationStreamingInfo, stopStreaming, isStreamingNow };
}
