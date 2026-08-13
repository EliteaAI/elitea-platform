/**
 * model/useChatStreamTransport.ts — the chat transport swap (issue #93, Surface B).
 *
 * This is the producer the reducer was written for. Until now the chat
 * surface started its run by emitting socket.io `chat_predict` and rendered
 * the answer only once `chat_message_sync` pushed the PERSISTED message group
 * — no live streaming at all, because, as `useChatBoxHandlers` said in place:
 * "the chat surface has no consumer for the streamed `execution.node_event`
 * envelope — the streaming reducer the old app fed from `chat_predict` was
 * never ported". It is ported now, so this hook closes the loop: start the run
 * over REST, subscribe to the durable replay stream, and fold each frame into
 * chat history with `applyChatStreamFrame`.
 *
 * FALLBACK IS PART OF THE CONTRACT, not defensiveness. `startAgentExecution`'s
 * own doc states it: the Go route REQUIRES a recognised `execution_contract`
 * and 400s without one, which is what makes any failure — or a 200 carrying no
 * `events_url` — an unambiguous "this backend has not landed the SSE path".
 * `start` reports that by returning `false`, and the caller then emits
 * `chat_predict` exactly as before. A backend mid-migration keeps working.
 *
 * WHAT THIS HOOK DOES NOT DO: it never re-starts a run. Once the POST has
 * succeeded the execution exists server-side, so a transport failure after
 * that point must not fall back to the socket — that would run the agent
 * twice and bill it twice. It stops the spinner and surfaces the failure
 * instead.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  startAgentExecution,
  type AgentExecutionStart,
  type StartAgentExecutionParams,
} from '@/entities/conversation/api/conversationApi';
import { useExecutionEventStream, type ExecutionEventData } from '@/shared/api/sse';

import { applyChatStreamFrame, type ChatStreamContext } from '../lib/chatStreamReducer';
import { isChatStreamFrame } from '../lib/chatStreamFrame';
import { shouldForwardAgentEvent } from '../lib/agentGraphEvents';

import type { ChatMessage } from '../lib/convertMessagesToChatHistory';

type SetChatHistory = (updater: (prev: readonly ChatMessage[]) => readonly ChatMessage[]) => void;

/** @public Params for `useChatStreamTransport`. */
export interface UseChatStreamTransportParams {
  readonly setChatHistory: SetChatHistory;
  /** Identity for messages the reducer has to create, plus the participant roster. */
  readonly context?: ChatStreamContext | undefined;
  /**
   * Graph frames, for a surface that renders a run timeline (the pipeline
   * flow editor). Chat itself ignores them; forwarding is the caller's half of
   * the baseline's `onRcvAgentEvent`, see `agentGraphEvents.ts`.
   */
  readonly onAgentEvent?: ((frame: ExecutionEventData) => void) | undefined;
  /** The run itself failed server-side, or its stream dropped. */
  readonly onStreamError?: ((reason: string) => void) | undefined;
}

/** @public */
export interface UseChatStreamTransportResult {
  /**
   * Start a run over REST and take ownership of its stream.
   *
   * `true` ⇒ this transport owns the run and the caller must NOT emit
   * `chat_predict`. `false` ⇒ the backend serves no replay stream; fall back.
   */
  readonly start: (params: StartAgentExecutionParams) => Promise<boolean>;
  /** Whether a stream is currently subscribed — for tests and diagnostics. */
  readonly isStreaming: boolean;
  /** Stop consuming the current stream (conversation switch, stop button). */
  readonly close: () => void;
}

/**
 * Clear the in-flight flags on whatever is still streaming.
 *
 * A transport failure leaves the run's message spinning forever otherwise:
 * the frames that would have ended it are exactly the ones that stopped
 * arriving.
 */
function settleInFlight(history: readonly ChatMessage[], exception?: unknown): readonly ChatMessage[] {
  let changed = false;
  const next = history.map((message) => {
    if (!message.isStreaming && !message.isLoading) return message;
    changed = true;
    return {
      ...message,
      isStreaming: false,
      isLoading: false,
      isRegenerating: false,
      ...(exception !== undefined ? { exception } : {}),
    };
  });
  return changed ? next : history;
}

export function useChatStreamTransport(params: UseChatStreamTransportParams): UseChatStreamTransportResult {
  const { setChatHistory, context, onAgentEvent, onStreamError } = params;
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);

  // Read through a ref so a changing context does not re-open the stream:
  // `useExecutionEventStream` keys its connection on the URL and the handler
  // identities, and a reconnect mid-answer would replay the run from the
  // cursor and duplicate what is already on screen.
  const contextRef = useRef<ChatStreamContext | undefined>(context);
  contextRef.current = context;
  const onAgentEventRef = useRef(onAgentEvent);
  onAgentEventRef.current = onAgentEvent;
  const onStreamErrorRef = useRef(onStreamError);
  onStreamErrorRef.current = onStreamError;

  const onNodeEvent = useCallback(
    (frame: ExecutionEventData) => {
      // A frame with no `type` names no case; the reducer would return the
      // same array, but the forward below would still fire on it.
      if (!isChatStreamFrame(frame)) return;
      setChatHistory((prev) => applyChatStreamFrame(prev, frame, contextRef.current ?? {}));
      if (shouldForwardAgentEvent(frame.type)) onAgentEventRef.current?.(frame);
    },
    [setChatHistory],
  );

  const onFailed = useCallback(
    (frame: ExecutionEventData) => {
      // The server reporting the EXECUTION failed — distinct from the stream
      // dropping. The reason is shown on the message, not swallowed.
      const reason = typeof frame['error'] === 'string' ? frame['error'] : 'The agent run failed.';
      setChatHistory((prev) => settleInFlight(prev, reason));
      setEventsUrl(null);
      onStreamErrorRef.current?.(reason);
    },
    [setChatHistory],
  );

  const onError = useCallback(() => {
    // Transport-level: the stream never opened, or dropped. EventSource does
    // not retry after an HTTP status, so nothing further will arrive.
    setChatHistory((prev) => settleInFlight(prev));
    setEventsUrl(null);
    onStreamErrorRef.current?.('The connection to the agent run was lost.');
  }, [setChatHistory]);

  useExecutionEventStream(eventsUrl, { onNodeEvent, onFailed, onError });

  const start = useCallback(async (startParams: StartAgentExecutionParams): Promise<boolean> => {
    let started: AgentExecutionStart;
    try {
      started = await startAgentExecution(startParams);
    } catch {
      // Not an error to report: on a backend without the SSE path this is the
      // EXPECTED answer, and the caller recovers by emitting chat_predict.
      return false;
    }
    // A 200 with no events_url is the same signal — an older backend answering
    // the same route. Treating it as success would leave the run unwatched.
    if (!started.events_url) return false;
    setEventsUrl(started.events_url);
    return true;
  }, []);

  const close = useCallback(() => {
    setEventsUrl(null);
  }, []);

  return useMemo(
    () => ({ start, isStreaming: eventsUrl !== null, close }),
    [start, eventsUrl, close],
  );
}
