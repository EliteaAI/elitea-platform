/**
 * entities/canvas/api/canvasSocket.ts — the 7 non-room canvas socket hooks
 * from `apps/elitea-ui/src/hooks/chat/useCanvasSocket.js` (unit C1's canvas
 * cluster). Ported close to 1:1 as thin wrappers over
 * `shared/api/socket/client.ts`'s `useSocketClient().emit/.on/.off` — each
 * old "listen.../stopListen..." pair becomes a `subscribe`/`unsubscribe`
 * effect exactly like the old file's own `useEffect(() => { subscribe();
 * return unsubscribe; }, [...])` shape (S5's `client.on/off` already IS the
 * validating subscribe/unsubscribe primitive the old file's `useManualSocket`
 * provided).
 *
 * `useJoinCanvasSocket`/`useLeaveCanvasRoomSocket` (old file's other 2 hooks)
 * are DELIBERATELY NOT ported here — `shared/api/socket/rooms.ts`'s
 * `useCanvasRoom(canvasUuid, {projectId, enabled})` already replaces that
 * exact join/leave pair (ref-counted, leave-on-unmount guaranteed). Callers
 * needing canvas room membership import `useCanvasRoom` directly from
 * `shared/api/socket` — re-exporting it here would just be an unnecessary
 * indirection through a second barrel.
 *
 * Export-budget curation: `useCanvasEditorJoinedSocket` and
 * `useCanvasEditorsChangeSocket` (old file's 2 presence hooks — one fires on
 * a single editor joining, the other on the room's editor LIST changing) are
 * merged into ONE exported hook, `useCanvasPresenceSocket`, rather than kept
 * as 2 separate exports. This is a deliberate export-count deviation (not a
 * behavioral one): both events are always consumed by the same
 * canvas-editor-presence UI in the old app (CanvasEditor.jsx), the merged
 * hook still exposes both event's listen/stop pairs individually via its
 * return object (nothing is dropped, only grouped), and entities/canvas's
 * public barrel had exactly 1 slot of headroom left within the ≤20 budget
 * once the other 6 socket hooks + 6 REST hooks (canvasApi.ts) were counted.
 *
 * project_id threading: the old hooks read `project_id` off
 * `useSelectedProjectId()` (a Redux hook) internally. `entities/` cannot
 * depend on routing/Redux-equivalent state (no-upward-from-entities), so
 * every hook below takes `projectId` as an explicit optional caller-supplied
 * argument instead — callers already have it (route params / project
 * context), matching `useCanvasRoom`'s own `{projectId}` option shape.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useSocketClient } from '@/shared/api/socket/client';
import type { EmitPayloadOf, ReceivePayloadOf } from '@/shared/api/socket/events';

/* ── chat_canvas_edit (emit) — apps/elitea-ui/.../useCanvasSocket.js:37-49 ── */

export interface UseCanvasEditSocketResult {
  /** Broadcasts a local content edit to every other canvas-room subscriber. */
  readonly sendChangeToRemote: (canvasUuid: string, content: unknown, projectId?: string) => void;
}

export function useCanvasEditSocket(): UseCanvasEditSocketResult {
  const client = useSocketClient();
  const sendChangeToRemote = useCallback(
    (canvasUuid: string, content: unknown, projectId?: string) => {
      const payload = {
        canvas_uuid: canvasUuid,
        content,
        ...(projectId !== undefined ? { project_id: projectId } : {}),
      } satisfies EmitPayloadOf<'chat_canvas_edit'>;
      client.emit('chat_canvas_edit', payload);
    },
    [client],
  );
  return { sendChangeToRemote };
}

/**
 * Shared shape for the 4 simple "receive one event, unwrap, forward to a
 * caller callback" hooks below — old file's identical
 * `onXRef`/`useEffect(sync ref)`/`handleSocketEvent`/`subscribe-on-mount`
 * pattern, repeated once per event there and factored into one helper here.
 */
function useCanvasReceive<E extends 'chat_canvas_sync' | 'chat_canvas_error' | 'chat_canvas_detail' | 'chat_canvas_content_change'>(
  event: E,
  onEvent: (payload: ReceivePayloadOf<E>) => void,
): { readonly listen: () => void; readonly stop: () => void } {
  const client = useSocketClient();
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const handler = useCallback((payload: ReceivePayloadOf<E>) => {
    onEventRef.current(payload);
  }, []);

  const listen = useCallback(() => client.on(event, handler), [client, event, handler]);
  const stop = useCallback(() => client.off(event, handler), [client, event, handler]);

  useEffect(() => {
    listen();
    return () => stop();
  }, [listen, stop]);

  return { listen, stop };
}

/* ── chat_canvas_sync (receive) — useCanvasSocket.js:51-76 ── */

export interface UseCanvasSyncSocketResult {
  readonly listenCanvasSyncEvent: () => void;
  readonly stopListenCanvasSyncEvent: () => void;
}

/** `onCanvasSync` receives the ALREADY-UNWRAPPED `content` field (old file unwraps `message.content` before forwarding, :58-60). */
export function useCanvasSyncSocket(params: { readonly onCanvasSync: (content: unknown) => void }): UseCanvasSyncSocketResult {
  const { listen, stop } = useCanvasReceive('chat_canvas_sync', (message) => params.onCanvasSync(message.content));
  return { listenCanvasSyncEvent: listen, stopListenCanvasSyncEvent: stop };
}

/* ── chat_canvas_error (receive) — useCanvasSocket.js:78-101 ── */

export interface UseCanvasErrorSocketResult {
  readonly listenCanvasErrorEvent: () => void;
  readonly stopListenCanvasErrorEvent: () => void;
}

export function useCanvasErrorSocket(params: { readonly onCanvasError: (payload: unknown) => void }): UseCanvasErrorSocketResult {
  const { listen, stop } = useCanvasReceive('chat_canvas_error', params.onCanvasError);
  return { listenCanvasErrorEvent: listen, stopListenCanvasErrorEvent: stop };
}

/* ── chat_canvas_detail (receive) — useCanvasSocket.js:103-128 ── */

export interface UseCanvasDetailSocketResult {
  readonly listenCanvasDetailEvent: () => void;
  readonly stopListenCanvasDetailEvent: () => void;
}

/** `onCanvasDetail` receives the ALREADY-UNWRAPPED `content` field (old file unwraps `message.content`, :110-112). */
export function useCanvasDetailSocket(params: { readonly onCanvasDetail: (content: unknown) => void }): UseCanvasDetailSocketResult {
  const { listen, stop } = useCanvasReceive('chat_canvas_detail', (message) => params.onCanvasDetail(message.content));
  return { listenCanvasDetailEvent: listen, stopListenCanvasDetailEvent: stop };
}

/* ── chat_canvas_content_change (receive) — useCanvasSocket.js:182-206 ── */

export interface UseCanvasContentChangeSocketResult {
  readonly listenCanvasContentChangeEvent: () => void;
  readonly stopListenCanvasContentChangeEvent: () => void;
}

/** server.go:252 broadcasts the raw edit payload verbatim — no unwrap, unlike sync/detail. */
export function useCanvasContentChangeSocket(params: {
  readonly onCanvasContentChange: (payload: ReceivePayloadOf<'chat_canvas_content_change'>) => void;
}): UseCanvasContentChangeSocketResult {
  const { listen, stop } = useCanvasReceive('chat_canvas_content_change', params.onCanvasContentChange);
  return { listenCanvasContentChangeEvent: listen, stopListenCanvasContentChangeEvent: stop };
}

/* ── chat_canvas_editor_joined + chat_canvas_editors_change (receive) ────────
   useCanvasSocket.js:130-180 — merged into one hook, see module doc. ────── */

export interface UseCanvasPresenceSocketParams {
  readonly onCanvasEditorJoined: (payload: ReceivePayloadOf<'chat_canvas_editor_joined'>) => void;
  readonly onCanvasEditorsChange: (payload: ReceivePayloadOf<'chat_canvas_editors_change'>) => void;
}

export interface UseCanvasPresenceSocketResult {
  readonly listenCanvasEditorJoinedEvent: () => void;
  readonly stopListenCanvasEditorJoinedEvent: () => void;
  readonly listenCanvasEditorsChangeEvent: () => void;
  readonly stopListenCanvasEditorsChangeEvent: () => void;
}

export function useCanvasPresenceSocket(params: UseCanvasPresenceSocketParams): UseCanvasPresenceSocketResult {
  const client = useSocketClient();
  const onJoinedRef = useRef(params.onCanvasEditorJoined);
  const onChangeRef = useRef(params.onCanvasEditorsChange);
  useEffect(() => {
    onJoinedRef.current = params.onCanvasEditorJoined;
  }, [params.onCanvasEditorJoined]);
  useEffect(() => {
    onChangeRef.current = params.onCanvasEditorsChange;
  }, [params.onCanvasEditorsChange]);

  const joinedHandler = useCallback((payload: ReceivePayloadOf<'chat_canvas_editor_joined'>) => {
    onJoinedRef.current(payload);
  }, []);
  const changeHandler = useCallback((payload: ReceivePayloadOf<'chat_canvas_editors_change'>) => {
    onChangeRef.current(payload);
  }, []);

  const listenJoined = useCallback(() => client.on('chat_canvas_editor_joined', joinedHandler), [client, joinedHandler]);
  const stopJoined = useCallback(() => client.off('chat_canvas_editor_joined', joinedHandler), [client, joinedHandler]);
  const listenChange = useCallback(() => client.on('chat_canvas_editors_change', changeHandler), [client, changeHandler]);
  const stopChange = useCallback(() => client.off('chat_canvas_editors_change', changeHandler), [client, changeHandler]);

  useEffect(() => {
    listenJoined();
    listenChange();
    return () => {
      stopJoined();
      stopChange();
    };
  }, [listenJoined, stopJoined, listenChange, stopChange]);

  return {
    listenCanvasEditorJoinedEvent: listenJoined,
    stopListenCanvasEditorJoinedEvent: stopJoined,
    listenCanvasEditorsChangeEvent: listenChange,
    stopListenCanvasEditorsChangeEvent: stopChange,
  };
}
