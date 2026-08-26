/**
 * stream.hook.ts — the support assistant's transport, and the ONE file in this
 * vendored tree that is not a port of `@eliteaai/elitea-assistant`.
 *
 * IT REPLACES `socket.hook.ts`, which was deleted rather than adapted. The
 * published widget streams a turn over socket.io: it emits `support_predict`,
 * joins a room with `chat_enter_room`, and folds `chat_predict` frames as they
 * arrive. This platform serves no socket.io — elitea-main streams over SSE
 * (`internal/api/v2/executions`, and the #93 chat-transport port that moved the
 * chat surface onto it) — so a turn is STARTED over REST and its frames arrive
 * on the durable execution stream.
 *
 * THE FRAMES THEMSELVES ARE UNCHANGED, which is why the rest of the vendored
 * tree needed no edit to render them: `features/chat-messages/lib/
 * chatStreamFrame.ts` documents that the SSE `execution.node_event` payload is
 * byte-identical to the socket's `chat_predict` receive event — it even carries
 * `sio_event: "chat_predict"`. `chat.hook.ts`'s reducer therefore consumes what
 * this hook delivers without knowing which transport produced it.
 *
 * # What is genuinely lost, stated rather than hidden
 *
 *   - THERE ARE NO ROOMS. A socket room is a subscription to a CONVERSATION; an
 *     execution stream is a subscription to ONE TURN. `chat_enter_room` /
 *     `chat_leave_room` have no equivalent and are gone. The practical
 *     difference: this widget sees its own turns and nothing else, so a support
 *     conversation open in two tabs no longer mirrors between them. Nothing in
 *     the support product depends on that — a support conversation has exactly
 *     one human participant, by construction.
 *
 *   - `chat_conversation_name_updated` IS GONE for the same reason. The server
 *     renamed a conversation and pushed the new name down the room; there is no
 *     room to push it down. The history list picks the name up on its next read
 *     instead of live.
 *
 * # Resume
 *
 * `EventSource` retries only after a CLEAN end and only via a `Last-Event-ID`
 * header, neither of which survives this backend (`shared/api/sse/resume.ts`),
 * so the reconnect is this hook's job: on a drop it reopens the SAME execution's
 * stream with `?cursor=<last id seen>`, which the server treats exactly as
 * `Last-Event-ID` and replays only what follows.
 *
 * A STREAM IS NEVER RESTARTED, only reopened. Once the POST has succeeded the
 * run exists server-side and is being billed; falling back to "start it again"
 * on a transport failure would run the support agent twice for one question.
 * When the retry budget is spent the hook reports the failure and stops.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { streamReconnectDelayMs, useExecutionEventStream, withResumeCursor, type ExecutionEventData } from '@/shared/api/sse';

/** What a caller has to handle. */
export interface SupportStreamCallbacks {
  /** One progress frame, in the shape `chat.hook.ts`'s reducer already reads. */
  readonly onFrame: (frame: ExecutionEventData) => void;
  /**
   * The turn is over, one way or another — a terminal frame, a server-reported
   * failure, or a reconnect budget that ran out. `reason` is set only for the
   * failure cases, and is safe to show to the user.
   */
  readonly onSettled: (reason?: string) => void;
}

/** What the caller gets back. */
export interface SupportStream {
  /** Subscribe to the `events_url` the predict endpoint answered with. */
  readonly open: (eventsUrl: string) => void;
  /** Drop the current stream without settling anything. */
  readonly close: () => void;
  /** True while a turn's stream is attached. */
  readonly isStreaming: boolean;
}

interface Connection {
  /** The URL the run was started on — the base every resume is built from. */
  readonly baseUrl: string;
  /** `null` is the gap between a drop and its reopen. */
  readonly url: string | null;
}

export const useSupportStream = (callbacks: SupportStreamCallbacks): SupportStream => {
  const [connection, setConnection] = useState<Connection | null>(null);
  const cursorRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settledRef = useRef(false);

  // The callbacks travel through refs so that a caller re-rendering with new
  // closures does not tear down and reopen the HTTP stream. A reopened stream
  // replays from the cursor, so this would not lose frames — it would just
  // reconnect on every keystroke in the message box.
  const onFrameRef = useRef(callbacks.onFrame);
  const onSettledRef = useRef(callbacks.onSettled);
  onFrameRef.current = callbacks.onFrame;
  onSettledRef.current = callbacks.onSettled;

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current !== undefined) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = undefined;
    }
  }, []);

  const detach = useCallback(() => {
    clearRetry();
    attemptRef.current = 0;
    cursorRef.current = null;
    setConnection(null);
  }, [clearRetry]);

  const open = useCallback(
    (eventsUrl: string) => {
      clearRetry();
      attemptRef.current = 0;
      cursorRef.current = null;
      settledRef.current = false;
      setConnection({ baseUrl: eventsUrl, url: eventsUrl });
    },
    [clearRetry],
  );

  const close = useCallback(() => {
    settledRef.current = true;
    detach();
  }, [detach]);

  const settle = useCallback(
    (reason?: string) => {
      if (settledRef.current) return;
      settledRef.current = true;
      detach();
      onSettledRef.current(reason);
    },
    [detach],
  );

  const onCursor = useCallback((cursor: string) => {
    cursorRef.current = cursor;
  }, []);

  const onNodeEvent = useCallback(
    (frame: ExecutionEventData) => {
      onFrameRef.current(frame);
      // The reducer decides what a frame MEANS; this decides when the stream is
      // no longer worth holding open. `agent_response` and `pipeline_finish`
      // are the two frames after which nothing further arrives for the turn.
      const type = typeof frame['type'] === 'string' ? frame['type'] : '';
      if (type === 'agent_response' || type === 'pipeline_finish') {
        settledRef.current = true;
        detach();
        onSettledRef.current();
      }
    },
    [detach],
  );

  const onFailed = useCallback(
    (frame: ExecutionEventData) => {
      // The SERVER reporting that the execution failed — distinct from the
      // stream dropping, and not something a reconnect can fix.
      const safe = frame['safe_message'] ?? frame['error'];
      settle(typeof safe === 'string' && safe !== '' ? safe : 'The support assistant could not answer.');
    },
    [settle],
  );

  const onError = useCallback(() => {
    if (settledRef.current) {
      detach();
      return;
    }
    const baseUrl = connection?.baseUrl;
    if (baseUrl === undefined) return;

    const attempt = attemptRef.current + 1;
    const delay = streamReconnectDelayMs(attempt);
    if (delay === undefined) {
      // The budget is spent. Settling is what stops the message spinning
      // forever: the frames that would have ended the turn are exactly the ones
      // that stopped arriving.
      settle('The connection to the support assistant was lost.');
      return;
    }
    attemptRef.current = attempt;
    clearRetry();
    // Drop the dead connection NOW rather than at reopen time. Clearing the URL
    // first is what makes the reopen re-run the subscription even when the
    // resumed URL is byte-identical to the one that just failed.
    setConnection({ baseUrl, url: null });
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = undefined;
      setConnection({ baseUrl, url: withResumeCursor(baseUrl, cursorRef.current) });
    }, delay);
  }, [connection, detach, clearRetry, settle]);

  // No `onReplayReset`. `execution.replay_reset` says the durable log was pruned
  // past the cursor this client resumed from — a hole in the transcript, not a
  // failed turn and not a reason to reconnect onto the same pruned cursor.
  // `onCursor` fires for it like any other event, so the cursor moves past the
  // gap and the surviving frames still finish the answer.
  useExecutionEventStream(connection?.url ?? null, { onNodeEvent, onFailed, onCursor, onError });

  useEffect(() => clearRetry, [clearRetry]);

  return { open, close, isStreaming: connection !== null };
};
