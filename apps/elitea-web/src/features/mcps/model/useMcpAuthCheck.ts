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

/**
 * Baseline's `SUCCESS_MESSAGE_TYPES` array (`useMcpAuthCheck.hooks.js:11-17`)
 * lists `SocketMessageType.AgentToolEnd`, `.AgentResponse`, `.AgentMessage`,
 * `.ToolResponseComplete`, `.FullMessage` — but `SocketMessageType`
 * (`common/constants.js:157-192`) has no `AgentMessage`, `ToolResponseComplete`,
 * or `FullMessage` key at all. Those three entries evaluate to `undefined`
 * in the real baseline app, i.e. they can never match a real
 * `message.type` string and are dead weight — the baseline's REAL,
 * behaving success set is only `agent_tool_end` + `agent_response`.
 * `'chat_user_message'` and `'chunk'` (a mid-stream partial fragment) are
 * real, defined `SocketMessageType` values, but NEITHER was ever in the
 * baseline's success list — they must stay OUT of this set, or a
 * connection test gets marked "successful" on a message that isn't a
 * completion signal (e.g. the user's own echoed chat message, or a partial
 * streaming chunk that a real completion/error message will still follow).
 */
const SUCCESS_MESSAGE_TYPES: ReadonlySet<string> = new Set(['agent_tool_end', 'agent_response']);

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
  // Exact function reference passed to `socket.on(...)` for the check
  // currently in flight (`null` when idle) — `off()` needs this precise
  // reference to remove the right listener, kept separate from
  // `handleSocketResponse` itself so `cleanupSession` doesn't have to
  // depend on that callback's identity (see its doc comment below).
  const activeHandlerRef = useRef<((message: TestConnectionMessage) => void) | null>(null);

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

  /**
   * Unsubscribes the socket listener registered for the CHECK IN FLIGHT (if
   * any) and resets running state. Reads `activeHandlerRef` rather than
   * closing over `handleSocketResponse` directly — `handleSocketResponse`
   * itself calls `cleanupSession`, so a direct reference would be a
   * circular `useCallback` dependency.
   */
  const cleanupSession = useCallback(() => {
    setIsRunning(false);
    streamIdRef.current = null;
    if (activeHandlerRef.current) {
      socket.off('test_mcp_connection', activeHandlerRef.current);
      activeHandlerRef.current = null;
    }
  }, [socket]);

  const handleSocketResponse = useCallback(
    (message: TestConnectionMessage) => {
      // Fail closed, unconditionally: only ever act on a message whose
      // stream_id matches the check WE started. `streamIdRef.current` is
      // `null` whenever no check is active, and `null !== message.stream_id`
      // for every real message (including one with no stream_id at all), so
      // an idle instance rejects everything — it does not "open up" just
      // because `streamIdRef.current` happens to be falsy. (The socket
      // listener is also only attached below, from `runAuthCheck` to
      // `cleanupSession`/unmount, for the same reason: this SOCK-029 event
      // is broadcast to every client testing ANY toolkit, not scoped to
      // this instance, so both "don't listen while idle" AND "reject a
      // non-matching stream_id" are needed — see
      // useMcpAuthCheck.test.tsx's "ignores an unrelated toolkit's response
      // while idle" / "...after this check has already completed" tests.)
      if (message.stream_id !== streamIdRef.current) return;

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

  // Unregisters on unmount if a check is still in flight when the
  // component goes away — `cleanupSession` (above) handles the normal
  // check-completed case; this covers the abandoned-mid-check case.
  useEffect(() => {
    return () => {
      if (activeHandlerRef.current) {
        socket.off('test_mcp_connection', activeHandlerRef.current);
        activeHandlerRef.current = null;
      }
    };
  }, [socket]);

  const runAuthCheck = useCallback(() => {
    if (isRunning) return;
    setIsRunning(true);

    const streamId = nextId('stream');
    const messageId = nextId('msg');
    streamIdRef.current = streamId;

    // Subscribe only for the lifetime of THIS check, not the component's —
    // registering earlier (e.g. an always-on mount effect) would leave the
    // listener attached while idle, where any other toolkit's
    // `test_mcp_connection` response could reach `handleSocketResponse`.
    socket.on('test_mcp_connection', handleSocketResponse);
    activeHandlerRef.current = handleSocketResponse;

    socket.emit('test_mcp_connection', {
      stream_id: streamId,
      message_id: messageId,
      project_id: projectId,
      toolkit_config: buildTestConnectionToolkitConfig(toolkitId, values),
      mcp_tokens: values?.mcp_tokens ?? {},
    });
  }, [isRunning, toolkitId, projectId, values, socket, handleSocketResponse]);

  return { runAuthCheck, isRunning };
}
