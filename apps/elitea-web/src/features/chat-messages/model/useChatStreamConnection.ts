/**
 * model/useChatStreamConnection.ts — one run's SSE connection (issue #329).
 *
 * Split out of `model/useChatStreamTransport.ts` to keep that file inside the
 * §3.5 file-length budget of 400 lines — the same move `lib/chatStreamSettle.ts`
 * records in its own header. The seam is the CONNECTION lifecycle and nothing
 * else: opening a stream, remembering the cursor, reopening a dropped one,
 * giving up, detaching. Who owns the run (which conversation started it, what
 * Stop cancels) and what the frames MEAN stay with the transport, which is why
 * this module never touches chat history.
 *
 * RESUME (issue #329). `EventSource` retries only after a CLEAN end and only
 * via a `Last-Event-ID` header, neither of which survives this backend (see
 * `shared/api/sse/resume.ts`), so the reconnect is this module's job: on a drop
 * it reopens the SAME execution's stream with `?cursor=<last id seen>`, which
 * `events.go` treats exactly as `Last-Event-ID`. The server then replays only
 * what follows that cursor, which is what makes the resume free of duplicates
 * — the reducer's `agent_response` "already rendered" guard is a backstop for
 * one frame type, NOT a general de-duplicator (a replayed `agent_llm_chunk`
 * appends unconditionally). Nothing is reconnected once `close` has run, which
 * is how "the turn is over" and "the user pressed Stop" both stop the retries.
 *
 * IT NEVER RE-STARTS THE RUN. Once the start POST has succeeded the execution
 * exists server-side, so a transport failure after that point must not fall
 * back to the socket — that would run the agent twice and bill it twice. This
 * module only REOPENS the stream, and once the retry budget is spent it reports
 * the loss through `onConnectionLost` so the transport can end the turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "@/shared/i18n";
import {
  streamReconnectDelayMs,
  useExecutionEventStream,
  withResumeCursor,
  type ExecutionEventData,
} from "@/shared/api/sse";

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

/** What the transport wants told about the stream it asked for. */
export interface ChatStreamConnectionHandlers {
  /** One durable progress frame, in delivery order. */
  readonly onNodeEvent: (frame: ExecutionEventData) => void;
  /** The server reporting the EXECUTION failed — distinct from the stream dropping. */
  readonly onFailed: (frame: ExecutionEventData) => void;
  /**
   * The retry budget is spent and the stream is gone for good, with a reason
   * the user can read. The turn ends here: the frames that would have ended it
   * are exactly the ones that stopped arriving.
   */
  readonly onConnectionLost: (reason: string) => void;
}

/** @public The connection half of the chat transport. */
export interface ChatStreamConnection {
  /** A stream is open, or is between a drop and its scheduled reopen. */
  readonly isStreaming: boolean;
  /** Subscribe to `baseUrl`, from the beginning, with a fresh retry budget. */
  readonly open: (baseUrl: string) => void;
  /** Close the connection and cancel any pending reopen. Reconnects stop for good. */
  readonly close: () => void;
}

/**
 * Subscribe to whatever run `open` was last called with.
 *
 * The handlers are read through a ref: `useEventSource` keys its connection on
 * the URL and the registered event NAMES (never on handler identity), and this
 * hook must not become the thing that reopens a stream — a reopen mid-answer
 * replays from the cursor and duplicates what is already on screen.
 */
export function useChatStreamConnection(
  handlers: ChatStreamConnectionHandlers,
): ChatStreamConnection {
  const [connection, setConnection] = useState<StreamConnection | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /** The durable cursor of the last frame delivered — what a resume sends back. */
  const cursorRef = useRef<string | null>(null);
  /** The turn is over (finished, failed, or stopped): a drop must NOT reconnect. */
  const doneRef = useRef(false);
  /** Consecutive failed reopen attempts; reset by any delivered frame. */
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current === undefined) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = undefined;
  }, []);

  const close = useCallback(() => {
    doneRef.current = true;
    clearRetry();
    setConnection(null);
  }, [clearRetry]);

  const open = useCallback(
    (baseUrl: string) => {
      clearRetry();
      cursorRef.current = null;
      attemptRef.current = 0;
      doneRef.current = false;
      setConnection({ baseUrl, url: baseUrl });
    },
    [clearRetry],
  );

  const onCursor = useCallback((cursor: string) => {
    cursorRef.current = cursor;
    // A delivered frame is proof the connection works, so the next drop starts
    // its backoff from the top instead of inheriting a spent budget.
    attemptRef.current = 0;
  }, []);

  const onNodeEvent = useCallback((frame: ExecutionEventData) => {
    handlersRef.current.onNodeEvent(frame);
  }, []);

  const onFailed = useCallback((frame: ExecutionEventData) => {
    handlersRef.current.onFailed(frame);
  }, []);

  const onError = useCallback(() => {
    // Transport-level: the stream never opened, or dropped mid-answer.
    if (doneRef.current) {
      close();
      return;
    }
    const baseUrl = connection?.baseUrl;
    if (baseUrl === undefined) return;

    const attempt = attemptRef.current + 1;
    const delay = streamReconnectDelayMs(attempt);
    if (delay === undefined) {
      // The retry budget is spent. The message would spin forever otherwise:
      // the frames that would have ended the turn are exactly the ones that
      // stopped arriving. It carries the reason for the same reason a runtime
      // failure does — a stream that never delivered a frame has no message to
      // stop, and settling silently is indistinguishable from a lost question.
      handlersRef.current.onConnectionLost(
        t(
          "chatMessages.stream.connectionLost",
          "The connection to the agent run was lost.",
        ),
      );
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
      setConnection({
        baseUrl,
        url: withResumeCursor(baseUrl, cursorRef.current),
      });
    }, delay);
  }, [connection, close, clearRetry]);

  // No `onReplayReset`, and that is the handling rather than an omission.
  // `execution.replay_reset` says the durable log was pruned past the cursor
  // this client resumed from, so some progress frames are gone for good — a
  // hole in the transcript, not a failed turn and not a reason to reconnect
  // onto the same pruned cursor. `useExecutionEventStream` registers the event
  // name either way (an unregistered name is dropped SILENTLY by EventSource),
  // and `onCursor` fires for it like any other, so the cursor moves past the
  // gap and the surviving frames still finish the answer. A no-op callback
  // here would only look like handling that is not there.
  useExecutionEventStream(connection?.url ?? null, {
    onNodeEvent,
    onFailed,
    onCursor,
    onError,
  });

  // Release a pending reconnect on unmount. HONEST SCOPE: this is timer
  // hygiene, not the mechanism that stops a post-unmount stream — a late
  // `setConnection` on an unmounted component is already inert, so removing
  // this changes no observable behaviour and no test can prove it. What
  // actually keeps frames out after unmount is `useEventSource`'s own
  // `source.close()` teardown, which the unmount test does pin.
  useEffect(() => clearRetry, [clearRetry]);

  return useMemo(
    () => ({ isStreaming: connection !== null, open, close }),
    [connection, open, close],
  );
}
