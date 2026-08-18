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
 * twice and bill it twice. It REOPENS the stream (see below) and, once the
 * retry budget is spent, stops the spinner and surfaces the failure instead.
 *
 * STREAM OWNERSHIP (issue #328). A stream belongs to the conversation that
 * started it, and to nothing else. The hook stays mounted across a
 * conversation switch — `ChatBox` re-renders with a new `conversationUuid`
 * rather than remounting — so an open stream would otherwise keep folding its
 * frames into whatever history is mounted next, i.e. into a DIFFERENT
 * conversation's transcript. The stream is therefore closed the moment the
 * active conversation stops matching the stream's owner — and, for the one
 * ordering that closing cannot cover, a `start` whose POST resolves after the
 * user has already left subscribes to nothing at all.
 *
 * RESUME (issue #329). `EventSource` retries only after a CLEAN end and only
 * via a `Last-Event-ID` header, neither of which survives this backend (see
 * `shared/api/sse/resume.ts`), so the reconnect is this hook's job: on a drop
 * it reopens the SAME execution's stream with `?cursor=<last id seen>`, which
 * `events.go` treats exactly as `Last-Event-ID`. The server then replays only
 * what follows that cursor, which is what makes the resume free of duplicates
 * — the reducer's `agent_response` "already rendered" guard is a backstop for
 * one frame type, NOT a general de-duplicator (a replayed `agent_llm_chunk`
 * appends unconditionally). Nothing is reconnected once the turn is over or
 * the user pressed Stop.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  startAgentExecution,
  stopChatTask,
  type AgentExecutionStart,
  type StartAgentExecutionParams,
  type StopChatTaskParams,
} from '@/entities/conversation/api/conversationApi';
import { streamReconnectDelayMs, useExecutionEventStream, withResumeCursor, type ExecutionEventData } from '@/shared/api/sse';

import { applyChatStreamFrame, type ChatStreamContext } from '../lib/chatStreamReducer';
import { isChatStreamFrame, SocketMessageType, type ChatStreamFrame } from '../lib/chatStreamFrame';
import { shouldForwardAgentEvent } from '../lib/agentGraphEvents';

import type { ChatMessage } from '../lib/convertMessagesToChatHistory';

type SetChatHistory = (updater: (prev: readonly ChatMessage[]) => readonly ChatMessage[]) => void;

/** @public Params for `useChatStreamTransport`. */
export interface UseChatStreamTransportParams {
  readonly setChatHistory: SetChatHistory;
  /**
   * The conversation currently on screen. A stream whose owner (the
   * `conversationUuid` its `start` was called with) stops matching this is
   * closed, and its frames are dropped rather than folded into the
   * conversation that is now mounted — issue #328. Leaving it undefined
   * disables the guard, which is only right for a caller that has exactly one
   * conversation for its whole lifetime.
   */
  readonly conversationUuid?: string | undefined;
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
  /** Whether a stream is currently subscribed — drives the composer's Stop affordance. */
  readonly isStreaming: boolean;
  /**
   * Detach from the current stream WITHOUT cancelling the run: close the
   * connection, cancel any pending reconnect, and leave the history alone.
   *
   * This is the conversation-switch / teardown path. It does not settle the
   * spinner because the history it would settle is the one now on screen,
   * which belongs to a different conversation.
   */
  readonly close: () => void;
  /**
   * The user pressed Stop. Cancels the run SERVER-SIDE (`DELETE
   * /elitea_core/task/prompt_lib/{projectId}/{responseMessageId}` — the id the
   * start endpoint returned), settles the message, and closes the stream
   * without reconnecting.
   */
  readonly stop: () => void;
}

/**
 * Is this the last frame of the turn?
 *
 * Only used to decide whether a subsequent disconnect deserves a reconnect —
 * the reducer, not this predicate, owns what a frame does to the message. The
 * two signals are the reducer's own: `pipeline_finish` (terminal for the whole
 * execution) and an `agent_response` carrying a `finish_reason` (the model
 * saying why it stopped). A response WITHOUT one is an intermediate answer in
 * a multi-step pipeline and must not end the stream.
 */
function isTurnTerminalFrame(frame: ChatStreamFrame): boolean {
  if (frame.type === SocketMessageType.PipelineFinish) return true;
  return frame.type === SocketMessageType.AgentResponse && Boolean(frame.response_metadata?.finish_reason);
}

/**
 * One subscription to one run: the URL currently open, and the cursor-free URL
 * a resume rebuilds from.
 *
 * `url: null` is the gap between a drop and its reopen — the connection is
 * closed, but the RUN is still this hook's, which is why the connection object
 * survives it. Collapsing that state to `null` would make `isStreaming` go
 * false for a second or eight mid-answer, and the composer would swap Stop
 * back for Send on a turn that has not stopped.
 */
interface StreamConnection {
  readonly baseUrl: string;
  readonly url: string | null;
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
  const { setChatHistory, conversationUuid, context, onAgentEvent, onStreamError } = params;
  const [connection, setConnection] = useState<StreamConnection | null>(null);

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
  // The conversation on screen NOW, and the one the open stream was started
  // for. `start` is async and resolves outside React's render, so the current
  // value has to be readable there rather than closed over (#328).
  const activeConversationRef = useRef<string | undefined>(conversationUuid);
  activeConversationRef.current = conversationUuid;
  const ownerRef = useRef<string | undefined>(undefined);

  /** The durable cursor of the last frame delivered — what a resume sends back. */
  const cursorRef = useRef<string | null>(null);
  /** The turn is over (finished, failed, or stopped): a drop must NOT reconnect. */
  const doneRef = useRef(false);
  /** Consecutive failed reopen attempts; reset by any delivered frame. */
  const attemptRef = useRef(0);
  /** What Stop has to cancel server-side, from the start endpoint's answer. */
  const cancelRef = useRef<StopChatTaskParams | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current === undefined) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = undefined;
  }, []);

  /**
   * Has this hook a run of its own? False once `detach` has run — including
   * during a pending reconnect, where nothing is subscribed but the run is
   * still this hook's to stop.
   */
  const ownsRun = useCallback((): boolean => ownerRef.current !== undefined, []);

  /** Close the connection and forget the run. Never touches chat history. */
  const detach = useCallback(() => {
    doneRef.current = true;
    ownerRef.current = undefined;
    cancelRef.current = null;
    clearRetry();
    setConnection(null);
  }, [clearRetry]);

  const onCursor = useCallback((cursor: string) => {
    cursorRef.current = cursor;
    // A delivered frame is proof the connection works, so the next drop starts
    // its backoff from the top instead of inheriting a spent budget.
    attemptRef.current = 0;
  }, []);

  const onNodeEvent = useCallback(
    (frame: ExecutionEventData) => {
      // A frame with no `type` names no case; the reducer would return the
      // same array, but the forward below would still fire on it.
      if (!isChatStreamFrame(frame)) return;
      setChatHistory((prev) => applyChatStreamFrame(prev, frame, contextRef.current ?? {}));
      // A terminal frame ENDS the turn, so the transport stops owning a run
      // right here — it does not wait for the connection to close, because
      // the server never closes it (executions/events.go keeps the stream open
      // and only emits `: heartbeat` comments afterwards). `isStreaming` is
      // `connection !== null`, and ChatBox now gates BOTH the Stop button and
      // the composer on it, so leaving the connection open past the terminal
      // frame left the composer disabled for the rest of the session — caught
      // by the #284 journey's "the composer must be released when the turn
      // ends".
      //
      // detach() never touches chat history, and it must not here: the
      // terminal frame has already settled the message through the reducer.
      if (isTurnTerminalFrame(frame)) detach();
      if (shouldForwardAgentEvent(frame.type)) onAgentEventRef.current?.(frame);
    },
    [setChatHistory, detach],
  );

  const onFailed = useCallback(
    (frame: ExecutionEventData) => {
      // The server reporting the EXECUTION failed — distinct from the stream
      // dropping. The reason is shown on the message, not swallowed.
      const reason = typeof frame['error'] === 'string' ? frame['error'] : 'The agent run failed.';
      detach();
      setChatHistory((prev) => settleInFlight(prev, reason));
      onStreamErrorRef.current?.(reason);
    },
    [setChatHistory, detach],
  );

  const onError = useCallback(() => {
    // Transport-level: the stream never opened, or dropped mid-answer.
    if (doneRef.current) {
      detach();
      return;
    }
    const baseUrl = connection?.baseUrl;
    if (baseUrl === undefined) return;

    const attempt = attemptRef.current + 1;
    const delay = streamReconnectDelayMs(attempt);
    if (delay === undefined) {
      // The retry budget is spent. The message would spin forever otherwise:
      // the frames that would have ended the turn are exactly the ones that
      // stopped arriving.
      detach();
      setChatHistory((prev) => settleInFlight(prev));
      onStreamErrorRef.current?.('The connection to the agent run was lost.');
      return;
    }
    attemptRef.current = attempt;
    clearRetry();
    // Drop the failed connection NOW rather than at reopen time: it is dead
    // either way, and clearing the URL first is what makes the reopen re-run
    // the subscription effect even when the resumed URL is byte-identical.
    setConnection({ baseUrl, url: null });
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      setConnection({ baseUrl, url: withResumeCursor(baseUrl, cursorRef.current) });
    }, delay);
  }, [connection, detach, clearRetry, setChatHistory]);

  // No `onReplayReset`, and that is the handling rather than an omission.
  // `execution.replay_reset` says the durable log was pruned past the cursor
  // this client resumed from, so some progress frames are gone for good — a
  // hole in the transcript, not a failed turn and not a reason to reconnect
  // onto the same pruned cursor. `useExecutionEventStream` registers the event
  // name either way (an unregistered name is dropped SILENTLY by EventSource),
  // and `onCursor` fires for it like any other, so the cursor moves past the
  // gap and the surviving frames still finish the answer. A no-op callback
  // here would only look like handling that is not there.
  useExecutionEventStream(connection?.url ?? null, { onNodeEvent, onFailed, onCursor, onError });

  // #328: the conversation on screen changed while a stream was open. The
  // stream belongs to the previous one, so it is dropped — without settling
  // any history, because the history in scope now is not the run's.
  useEffect(() => {
    if (connection === null) return;
    const owner = ownerRef.current;
    if (owner === undefined || conversationUuid === undefined || owner === conversationUuid) return;
    detach();
  }, [conversationUuid, connection, detach]);

  // Release a pending reconnect on unmount. HONEST SCOPE: this is timer
  // hygiene, not the mechanism that stops a post-unmount stream — a late
  // `setConnection` on an unmounted component is already inert, so removing
  // this changes no observable behaviour and no test can prove it. What
  // actually keeps frames out after unmount is `useEventSource`'s own
  // `source.close()` teardown, which the unmount test does pin.
  useEffect(() => clearRetry, [clearRetry]);

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
    // The user left this conversation while the POST was in flight. The run
    // EXISTS server-side now, so the answer is still `true` — the caller must
    // not fall back to `chat_predict` and run the agent twice — but nothing
    // subscribes: those frames belong to a transcript that is no longer on
    // screen, and the durable log replays them when it is reopened (#328).
    const active = activeConversationRef.current;
    if (active !== undefined && active !== startParams.conversationUuid) return true;
    clearRetry();
    cursorRef.current = null;
    attemptRef.current = 0;
    doneRef.current = false;
    ownerRef.current = startParams.conversationUuid;
    // `response_message_id` is what the cancel route addresses
    // (`DELETE .../task/prompt_lib/{projectID}/{responseMessageID}`). Without
    // one there is nothing to cancel and Stop can only detach.
    cancelRef.current =
      typeof started.response_message_id === 'string' && started.response_message_id !== ''
        ? { projectId: startParams.projectId, messageGroupUuid: started.response_message_id }
        : null;
    setConnection({ baseUrl: started.events_url, url: started.events_url });
    return true;
  }, [clearRetry]);

  const stop = useCallback(() => {
    // Nothing of this hook's is running — the run was already stopped, already
    // finished, or belonged to a conversation the user has left (which
    // detached it). Settling here would clear the spinner on somebody else's
    // in-flight message.
    if (!ownsRun()) return;
    const target = cancelRef.current;
    detach();
    setChatHistory((prev) => settleInFlight(prev));
    // Closing the client stream does not stop the agent: the execution exists
    // server-side and would keep burning tokens against the user's budget
    // while nobody watches. The DELETE is what actually ends it; its failure
    // is not surfaced because the run is already off this user's screen and a
    // 409 ("not active or cannot be stopped") is the expected answer when the
    // turn finished between the click and the request.
    if (target) void stopChatTask(target).catch(() => undefined);
  }, [detach, setChatHistory, ownsRun]);

  return useMemo(
    () => ({ start, isStreaming: connection !== null, close: detach, stop }),
    [start, connection, detach, stop],
  );
}
