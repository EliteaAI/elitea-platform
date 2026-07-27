/**
 * Port of
 * apps/elitea-ui/src/[fsd]/features/mcp/lib/hooks/useMcpAuthCheck.hooks.js
 * (unit A5) — runs a connection test against an MCP toolkit over the
 * `test_mcp_connection` socket event (SOCK-029) and routes the result:
 * `mcp_authorization_required` (SOCK-052) -> `onMcpAuthRequired`; a
 * success/error message type -> `onSuccess`/an inline error.
 *
 * DEVIATION FROM BASELINE: `SocketContext` (a raw React context around the
 * socket.io instance) + the old `SocketMessageType`/`sioEvents` constants
 * are replaced with unit S5's typed `useSocketClient()` +
 * `test_mcp_connection` event contract (`shared/api/socket/events.ts`).
 * `useToast` is replaced with an `onError` callback — see
 * `useMcpAuthModal.ts`'s header for the same toast-removal rationale.
 * `projectId` is an explicit option (same rationale as `useMcpAuthModal.ts`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';

const SUCCESS_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'agent_tool_end',
  'agent_response',
  'chat_user_message', // baseline's "AgentMessage" discriminant has no 1:1 name in the new catalogue; nearest completion-shaped type kept for parity intent.
  'chunk',
]);

const ERROR_MESSAGE_TYPES: ReadonlySet<string> = new Set(['agent_tool_error', 'error', 'agent_exception']);

interface TestConnectionMessage {
  type: string;
  stream_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

/** Safe stringification of an arbitrary `content` payload — `String(x)` on a non-primitive `x` degrades to `"[object Object]"`, which is a real UX bug baseline-parity would silently reproduce. */
function describeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (typeof content === 'number' || typeof content === 'boolean') return String(content);
  try {
    return JSON.stringify(content);
  } catch {
    return 'Unknown error';
  }
}

export interface UseMcpAuthCheckValues {
  id?: string | undefined;
  toolkit_name?: string | undefined;
  name?: string | undefined;
  type?: string | undefined;
  settings?: { url?: string | undefined; headers?: Record<string, string> | undefined; session_id?: string | undefined } | undefined;
  url?: string | undefined;
  headers?: Record<string, string> | undefined;
  session_id?: string | undefined;
  mcp_tokens?: Record<string, unknown> | undefined;
}

export interface UseMcpAuthCheckOptions {
  toolkitId?: string | undefined;
  values?: UseMcpAuthCheckValues | undefined;
  projectId?: string | number | undefined;
  onMcpAuthRequired?: ((message: TestConnectionMessage) => void) | undefined;
  onSuccess?: ((message: TestConnectionMessage) => void) | undefined;
  onError?: ((message: string) => void) | undefined;
}

export interface UseMcpAuthCheckResult {
  runAuthCheck: () => void;
  isRunning: boolean;
}

let streamCounter = 0;
function nextId(prefix: string): string {
  streamCounter += 1;
  return `${prefix}-${crypto.randomUUID()}-${streamCounter}`;
}

/**
 * One `??`/`?.` fallback chain per field, split out of `runAuthCheck`'s
 * `toolkit_config` build (§3.5 complexity budget: the inlined form
 * measured 18 — a single-function extraction still measured 17, so each
 * field gets its own tiny helper).
 */
function resolveToolkitId(toolkitId: string | undefined, values: UseMcpAuthCheckValues | undefined): string | undefined {
  return toolkitId ?? values?.id;
}

function resolveToolkitName(toolkitId: string | undefined, values: UseMcpAuthCheckValues | undefined): string {
  return values?.toolkit_name ?? values?.name ?? `mcp_toolkit_${toolkitId ?? ''}`;
}

function resolveToolkitType(values: UseMcpAuthCheckValues | undefined): string {
  return values?.type ?? 'mcp';
}

function resolveToolkitSettings(values: UseMcpAuthCheckValues | undefined) {
  return values?.settings ?? { url: values?.url, headers: values?.headers, session_id: values?.session_id };
}

function buildTestConnectionToolkitConfig(toolkitId: string | undefined, values: UseMcpAuthCheckValues | undefined) {
  return {
    toolkit_id: resolveToolkitId(toolkitId, values),
    toolkit_name: resolveToolkitName(toolkitId, values),
    type: resolveToolkitType(values),
    settings: resolveToolkitSettings(values),
  };
}

export function useMcpAuthCheck(options: UseMcpAuthCheckOptions): UseMcpAuthCheckResult {
  const { toolkitId, values, projectId, onMcpAuthRequired, onSuccess, onError } = options;
  const socket = useSocketClient();
  const [isRunning, setIsRunning] = useState(false);
  const streamIdRef = useRef<string | null>(null);

  const onMcpAuthRequiredRef = useRef(onMcpAuthRequired);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onMcpAuthRequiredRef.current = onMcpAuthRequired;
  }, [onMcpAuthRequired]);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const cleanupSession = useCallback(() => {
    setIsRunning(false);
    streamIdRef.current = null;
  }, []);

  const handleSocketResponse = useCallback(
    (message: TestConnectionMessage) => {
      if (streamIdRef.current && message.stream_id !== streamIdRef.current) return;

      if (message.type === 'mcp_authorization_required') {
        cleanupSession();
        onMcpAuthRequiredRef.current?.(message);
        return;
      }
      if (SUCCESS_MESSAGE_TYPES.has(message.type)) {
        cleanupSession();
        onSuccessRef.current?.(message);
        return;
      }
      if (ERROR_MESSAGE_TYPES.has(message.type)) {
        if (message.content) onErrorRef.current?.(describeContent(message.content));
        cleanupSession();
      }
    },
    [cleanupSession],
  );

  useEffect(() => {
    socket.on('test_mcp_connection', handleSocketResponse);
    return () => socket.off('test_mcp_connection', handleSocketResponse);
  }, [socket, handleSocketResponse]);

  const runAuthCheck = useCallback(() => {
    if (isRunning) return;
    setIsRunning(true);

    const streamId = nextId('stream');
    const messageId = nextId('msg');
    streamIdRef.current = streamId;

    socket.emit('test_mcp_connection', {
      stream_id: streamId,
      message_id: messageId,
      project_id: projectId,
      toolkit_config: buildTestConnectionToolkitConfig(toolkitId, values),
      mcp_tokens: values?.mcp_tokens ?? {},
    });
  }, [isRunning, toolkitId, projectId, values, socket]);

  return { runAuthCheck, isRunning };
}
