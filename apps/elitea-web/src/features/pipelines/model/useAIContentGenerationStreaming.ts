import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { getAvailableConfigurationsType } from '../api/aiAssistantConfigurations';
import { generateContentStreaming, stopLlmTask } from '../api/aiAssistantPredict';
import type { AiAssistantLlmSettings } from '../api/aiAssistantPredict';
import {
  AGENT_LLM_CHUNK,
  AGENT_LLM_END,
  AGENT_RESPONSE,
  AI_MESSAGE_CHUNK,
  CHUNK,
  FLUSH_KEEP_ALIVE_MS,
  LLM_ERROR,
  SAFETY_TIMEOUT_MS,
  SOCKET_ERROR,
  START_TASK,
  buildLlmSettings,
  convertSocketContent,
  getServicePromptDefaultsByKey,
  readGenerationBlocker,
} from '../lib/aiContentGenerationStreaming.helpers';
import type { ApplicationPredictStreamMessage } from '../lib/aiContentGenerationStreaming.helpers';
import { buildFieldContextPrompt, getServicePromptKeyForFieldName } from '../lib/aiAssistantPromptTemplates';
import { useServicePromptByKey } from './useServicePromptByKey';

import { useSocketClient } from '@/shared/api/socket/client';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/pipelines/ai-assistant/lib/
 * hooks/useAIContentGenerationStreaming.hooks.js` (baseline, 333 lines) —
 * unit A2a.
 *
 * DEVIATIONS FROM BASELINE, all forced by real, verified constraints (not
 * silent reinterpretation — see each item):
 *
 *  1. `projectId` is an explicit hook option instead of an internal
 *     `useSelectedProjectId()` call. Same reasoning + same precedent as
 *     `features/mcps/model/useMcpAuthModal.ts` (unit A5): `features/` has
 *     no reactive "current project" accessor to call, and the real source
 *     sits in a layer above `features/` (R-L1 forbids the import either
 *     way) — the caller (a `pages/`/`widgets/` component composing this
 *     panel into a real pipeline node) passes it down.
 *
 *  2. `socket`/`SocketContext` -> `useSocketClient()` (`shared/api/socket/
 *     client.ts`, unit S5). Typed `on`/`off`/`emit`/`socket.id` replace the
 *     baseline's raw `useContext(SocketContext)` + `useManualSocket`
 *     (`hooks/useSocket.jsx` — one of the 4 confirmed-not-promoted
 *     scattered hooks per the workflow preamble, and superseded outright by
 *     S5's typed client, not merely duplicated).
 *
 *  3. `toastError(...)` calls are replaced with an `errorMessage: string |
 *     null` return field the caller renders however it wants. No toast/
 *     snackbar primitive exists in `shared/ui` yet (`features/mcps/model/
 *     useMcpAuthModal.ts`'s doc comment records the same finding first) —
 *     `shared/ui` cannot import `features/useToast` either way (R-L1), so
 *     this hook (a `features/` file) could technically still import a
 *     features-local toast hook if one existed; since none does, the
 *     caller-decides pattern is used uniformly with the rest of this
 *     codebase's toast-removal precedent instead of inventing a one-off
 *     local toast just for this hook.
 *
 *  4. `uuidv4()` (the `uuid` package) -> `crypto.randomUUID()`. `uuid` is
 *     not a `package.json` dependency of this app (confirmed: absent from
 *     `package.json`); every other RFC4122-v4-needing call site in this
 *     codebase already uses the native Web Crypto API instead (`features/
 *     mcps/lib/crypto.ts`, `shared/api/upload.ts`, `shared/api/auth/
 *     popup.ts`) — same substitution, same output format, zero new
 *     dependency.
 *
 *  5. `getAvailableConfigurationsType`/`getConfigurationsList` (via
 *     `useServicePromptByKey`) come from `../api/aiAssistantConfigurations.ts`,
 *     a LOCAL copy of the same 2 endpoints `features/credentials/api/
 *     configurations.ts` already implements — `no-sideways-features`
 *     forbids importing across the `features/credentials` <-> `features/
 *     pipelines` boundary even via `index.ts`. See that file's own doc
 *     comment for the full rationale.
 *
 * Everything else — the buffered-chunk streaming state machine, the
 * `SAFETY_TIMEOUT_MS` backstop, `handleSocketEvent`'s switch over message
 * types, the `flushAndKeepAlive`/`finalize` dance — is unchanged behaviour,
 * only typed and re-pointed at the substitutions above.
 */

export interface UseAIContentGenerationStreamingOptions {
  readonly projectId: string | number | undefined;
  readonly modelConfig: AiAssistantLlmSettings | null | undefined;
  readonly fieldName: string | undefined;
  readonly stateVariablesInfo?: string;
  readonly availableNodesInfo?: string;
}

export interface UseAIContentGenerationStreamingResult {
  readonly generateContent: (userPrompt: string, currentContent?: string) => Promise<void>;
  readonly cancel: () => void;
  readonly isGenerating: boolean;
  readonly streamedContent: string;
  readonly hasError: boolean;
  readonly errorMessage: string | null;
  readonly resetContent: () => void;
}

export function useAIContentGenerationStreaming(
  options: UseAIContentGenerationStreamingOptions,
): UseAIContentGenerationStreamingResult {
  const { projectId, modelConfig, fieldName, stateVariablesInfo = '', availableNodesInfo = '' } = options;

  const servicePromptKey = getServicePromptKeyForFieldName(fieldName);
  const { prompt: promptFromConfig } = useServicePromptByKey(projectId, servicePromptKey);
  const { data: availableTypes } = useQuery({
    queryKey: ['pipelines', 'aiAssistant', 'availableConfigurationsType', 'service_prompts'],
    queryFn: ({ signal }) => getAvailableConfigurationsType({ section: 'service_prompts' }, signal),
    enabled: servicePromptKey !== null,
  });

  const defaultPromptsByKey = useMemo(() => getServicePromptDefaultsByKey(availableTypes), [availableTypes]);

  const basePromptOverride = useMemo(() => {
    if (promptFromConfig.trim()) return promptFromConfig;
    const fallback = servicePromptKey ? defaultPromptsByKey[servicePromptKey] : undefined;
    return fallback ?? '';
  }, [defaultPromptsByKey, promptFromConfig, servicePromptKey]);

  const socketClient = useSocketClient();

  const [streamedContent, setStreamedContent] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeStreamIdRef = useRef<string | null>(null);
  const genTokenRef = useRef(0);
  const chunkBufferRef = useRef<string[]>([]);
  const rafPendingRef = useRef(false);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetContent = useCallback(() => {
    chunkBufferRef.current = [];
    setStreamedContent('');
    setHasError(false);
    setErrorMessage(null);
  }, []);

  const checkAndSetError = useCallback((content: string) => {
    if (content.trimStart().startsWith('Error')) {
      setHasError(true);
    }
  }, []);

  const flushBuffered = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;

    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      if (!chunkBufferRef.current.length) return;

      const merged = chunkBufferRef.current.join('');
      chunkBufferRef.current = [];
      setStreamedContent((prev) => prev + merged);
    });
  }, []);

  const finalize = useCallback(() => {
    setIsGenerating(false);
    activeStreamIdRef.current = null;
    clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = undefined;
    clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = undefined;

    const remaining = chunkBufferRef.current.join('');
    chunkBufferRef.current = [];

    setStreamedContent((prev) => {
      const finalContent = prev + remaining;
      checkAndSetError(finalContent);
      return finalContent;
    });
  }, [checkAndSetError]);

  const flushAndKeepAlive = useCallback(() => {
    const remaining = chunkBufferRef.current.join('');
    chunkBufferRef.current = [];

    setStreamedContent((prev) => prev + remaining);

    clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = setTimeout(() => {
      if (activeStreamIdRef.current) {
        finalize();
      }
    }, FLUSH_KEEP_ALIVE_MS);
  }, [finalize]);

  const handleChunkMessage = useCallback(
    (message: ApplicationPredictStreamMessage) => {
      const chunk = convertSocketContent(message.content);
      if (chunk) {
        chunkBufferRef.current.push(chunk);
        flushBuffered();
      }
      if (message.response_metadata?.finish_reason) finalize();
    },
    [finalize, flushBuffered],
  );

  const handleAgentResponseMessage = useCallback(
    (message: ApplicationPredictStreamMessage) => {
      const finalText = convertSocketContent(message.content);
      chunkBufferRef.current = [];
      setStreamedContent(finalText);
      checkAndSetError(finalText);
      finalize();
    },
    [checkAndSetError, finalize],
  );

  const handleErrorMessage = useCallback(
    (message: ApplicationPredictStreamMessage) => {
      const err = (message.content as { error?: unknown } | undefined)?.error ?? message.content ?? 'Failed to generate content';
      setErrorMessage(typeof err === 'string' ? err : JSON.stringify(err));
      setHasError(true);
      finalize();
    },
    [finalize],
  );

  /** Split out of the socket `on()` handler so each case's own body — not this dispatch table — carries the complexity §3.5 budgets (12). */
  const dispatchSocketMessage = useCallback(
    (socketMessageType: string, message: ApplicationPredictStreamMessage) => {
      switch (socketMessageType) {
        case START_TASK:
          setIsGenerating(true);
          return;
        case CHUNK:
        case AI_MESSAGE_CHUNK:
        case AGENT_LLM_CHUNK:
          handleChunkMessage(message);
          return;
        case AGENT_RESPONSE:
          handleAgentResponseMessage(message);
          return;
        case AGENT_LLM_END:
          flushAndKeepAlive();
          return;
        case SOCKET_ERROR:
        case LLM_ERROR:
          handleErrorMessage(message);
          return;
        default:
      }
    },
    [flushAndKeepAlive, handleAgentResponseMessage, handleChunkMessage, handleErrorMessage],
  );

  const handleSocketEvent = useCallback(
    (message: ApplicationPredictStreamMessage) => {
      const activeId = activeStreamIdRef.current;
      if (!activeId || message.stream_id !== activeId) return;
      dispatchSocketMessage(message.type, message);
    },
    [dispatchSocketMessage],
  );

  useEffect(() => {
    socketClient.on('application_predict', handleSocketEvent);
    return () => {
      socketClient.off('application_predict', handleSocketEvent);
      clearTimeout(finalizeTimerRef.current);
      finalizeTimerRef.current = undefined;
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = undefined;
    };
  }, [handleSocketEvent, socketClient]);

  const cancel = useCallback(() => {
    const streamId = activeStreamIdRef.current;

    if (streamId && projectId !== undefined) {
      stopLlmTask(projectId, streamId).catch(() => {
        // Best-effort cancel — same swallow-and-move-on the baseline's own `.catch(() => {})` does.
      });
    }

    activeStreamIdRef.current = null;
    setIsGenerating(false);
    chunkBufferRef.current = [];
    clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = undefined;
    clearTimeout(safetyTimerRef.current);
    safetyTimerRef.current = undefined;
  }, [projectId]);

  const armSafetyTimeout = useCallback(
    (streamId: string) => {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = setTimeout(() => {
        if (activeStreamIdRef.current !== streamId) return;
        setErrorMessage('AI assistant timed out: no response received. Please try again.');
        setHasError(true);
        finalize();
      }, SAFETY_TIMEOUT_MS);
    },
    [finalize],
  );

  // Bundled so `generateContent`'s own `useCallback` dependency array stays
  // under the §3.5 budget (8) — these 4 values are only ever read together,
  // to build one prompt string.
  const promptContext = useMemo(
    () => ({ fieldName, stateVariablesInfo, availableNodesInfo, basePromptOverride }),
    [availableNodesInfo, basePromptOverride, fieldName, stateVariablesInfo],
  );

  const generateContent = useCallback(
    async (userPrompt: string, currentContent = ''): Promise<void> => {
      if (!userPrompt.trim()) return;
      const blocker = readGenerationBlocker(socketClient.socket.id, modelConfig?.model_name, projectId);
      if (blocker) {
        setErrorMessage(blocker);
        setHasError(true);
        return;
      }

      try {
        resetContent();
        const streamId = crypto.randomUUID();
        const fullPrompt = buildFieldContextPrompt(
          userPrompt,
          promptContext.fieldName,
          currentContent,
          promptContext.stateVariablesInfo,
          promptContext.availableNodesInfo,
          { basePromptOverride: promptContext.basePromptOverride },
        );

        activeStreamIdRef.current = streamId;
        genTokenRef.current += 1;
        const myToken = genTokenRef.current;
        setIsGenerating(true);
        armSafetyTimeout(streamId);

        const result = await generateContentStreaming(projectId as string | number, socketClient.socket.id as string, {
          message_id: crypto.randomUUID(),
          stream_id: streamId,
          user_input: fullPrompt,
          chat_history: [],
          llm_settings: buildLlmSettings(modelConfig as AiAssistantLlmSettings),
        });
        if (result.error) throw new Error(result.error);
        if (genTokenRef.current !== myToken) return; // Race protection
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to generate content');
        setHasError(true);
        cancel();
      }
    },
    [armSafetyTimeout, cancel, modelConfig, projectId, promptContext, resetContent, socketClient],
  );

  return {
    generateContent,
    cancel,
    isGenerating,
    streamedContent,
    hasError,
    errorMessage,
    resetContent,
  };
}
