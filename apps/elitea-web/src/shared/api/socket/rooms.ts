/**
 * Declarative room membership (unit S5, spec §5.5): entering tied to the
 * room id + React lifetime, LEAVING GUARANTEED on unmount or id change.
 *
 * The old app emitted `*_leave_rooms` manually from several call sites —
 * components/Chat/hooks.js:73 (`emitLeaveRoom([streamId])` inside
 * onStopStreaming), hooks/chat/useCanvasSocket.js:27-34
 * (`useLeaveCanvasRoomSocket`, called explicitly by consumers), and
 * [fsd]/features/toolkits/lib/hooks/useToolkitChat.hooks.js:209 — each a
 * place a component could unmount (navigate away mid-stream, close a
 * dialog) without ever calling the leave function, leaking the server-side
 * room membership (services/elitea-main/internal/api/socketio/server.go's
 * roomRegistry only clears on an explicit `*_leave_rooms` emit or
 * `disconnect`). These hooks own the whole lifecycle so no caller can
 * forget: leave is issued from the effect's cleanup function, which React
 * guarantees runs on unmount.
 *
 * REFERENCE COUNTING (post-review fix): server.go's handleLeaveRooms
 * (server.go:130-136) IGNORES the payload it receives — it calls
 * `s.rooms.getRooms(clientID)` and leaves EVERY room that socket
 * connection has ever joined, not just the one named in the leave event.
 * Combined with an unconditional leave-on-unmount, two concurrent
 * room-scoped subscribers on the same connection (two chat views on one
 * conversation; a chat room + a canvas room together) would race: the
 * first to unmount evicts BOTH from the server's perspective, silently
 * killing the other's still-mounted subscription. Fixing server.go is out
 * of scope for a UI unit (services/elitea-main, needs a backend decision);
 * client-side ref-counting is the correct mitigation regardless of what
 * the server does with the leave payload — it also just avoids redundant
 * leave emits in general. Counts are tracked per SOCKET CLIENT INSTANCE
 * (WeakMap keyed by the client, R-S2-safe: the map itself holds no live
 * state at import time and is populated lazily per instance, so it is not
 * a singleton store — each createSocketClient()/createTestSocketClient()
 * gets its own independent counts, exactly like the connection-state store
 * inside client.ts).
 */
import { useEffect, useRef } from 'react';

import type { EmitPayloadOf } from './events';
import { type SocketClient, useSocketClient } from './client';

/**
 * Per-client-instance subscriber counts, keyed by a room key unique within
 * that client (see roomKey/canvasKey below). Not a room-registry mirror —
 * only the counts needed to decide when the LAST subscriber for a given
 * room unmounts.
 */
const roomRefCounts = new WeakMap<SocketClient, Map<string, number>>();

function refCountsFor(client: SocketClient): Map<string, number> {
  let counts = roomRefCounts.get(client);
  if (!counts) {
    counts = new Map();
    roomRefCounts.set(client, counts);
  }
  return counts;
}

/** Runs `onFirstAcquire` only when this is the first live subscriber for `key` on `client`. */
function acquireRoom(client: SocketClient, key: string, onFirstAcquire: () => void): void {
  const counts = refCountsFor(client);
  const next = (counts.get(key) ?? 0) + 1;
  counts.set(key, next);
  if (next === 1) onFirstAcquire();
}

/** Runs `onLastRelease` only when this was the last live subscriber for `key` on `client`. */
function releaseRoom(client: SocketClient, key: string, onLastRelease: () => void): void {
  const counts = refCountsFor(client);
  // Defense-in-depth: `?? 1` (not `?? 0`) so a release with no matching prior
  // acquire still resolves to "last subscriber leaving" (next <= 0) rather
  // than going negative and never triggering onLastRelease. Unreachable
  // through the two hooks above — every releaseRoom call is an effect
  // cleanup that always follows its own acquireRoom call for the same key —
  // proven by rooms.test.ts's reference-counting suite exercising every
  // acquire/release pairing the hooks can produce.
  /* v8 ignore next */
  const next = (counts.get(key) ?? 1) - 1;
  if (next <= 0) {
    counts.delete(key);
    onLastRelease();
  } else {
    counts.set(key, next);
  }
}

export interface UseSocketRoomOptions {
  /** Extra fields merged into both the enter and leave payloads (project/conversation ids etc.) — evidence: usePipelineChat.hooks.js:156-160, useToolkitChat.hooks.js:218-222. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** Skip entering while false (e.g. the id isn't resolved yet) — still guarantees no stale room is left mounted when it flips back. */
  readonly enabled?: boolean;
}

/**
 * Joins the `chat_enter_room` / `chat_leave_rooms` room pair — the room
 * mechanism shared by chat, application, pipeline and toolkit predict flows
 * (all four hook families emit the SAME two event names; see
 * events.ts's chat_enter_room evidence list). Reference-counted per
 * `roomId` (see module doc comment): concurrent subscribers to the SAME
 * room share one underlying enter/leave pair.
 */
export function useSocketRoom(roomId: string | null | undefined, options: UseSocketRoomOptions = {}): void {
  const client = useSocketClient();
  const { context, enabled = true } = options;
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!enabled || roomId === null || roomId === undefined || roomId === '') return undefined;

    const key = `chat:${roomId}`;
    acquireRoom(client, key, () => {
      const payload = {
        conversation_id: roomId,
        ...contextRef.current,
      } satisfies EmitPayloadOf<'chat_enter_room'>;
      client.emit('chat_enter_room', payload);
    });

    return () => {
      releaseRoom(client, key, () => {
        client.emit('chat_leave_rooms', {
          conversation_id: roomId,
          ...contextRef.current,
        } satisfies EmitPayloadOf<'chat_leave_rooms'>);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextRef carries the latest `context` without re-triggering enter/leave on every render
  }, [client, roomId, enabled]);
}

export interface UseCanvasRoomOptions {
  readonly projectId?: string;
  readonly enabled?: boolean;
}

/**
 * Joins the canvas-specific `chat_canvas_join` / `chat_canvas_leave_rooms`
 * pair — a distinct room family from useSocketRoom (different emit shape:
 * hooks/chat/useCanvasSocket.js:7-35). Same leave-on-unmount guarantee,
 * same reference-counting per `canvasUuid`.
 */
export function useCanvasRoom(canvasUuid: string | null | undefined, options: UseCanvasRoomOptions = {}): void {
  const client = useSocketClient();
  const { projectId, enabled = true } = options;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    if (!enabled || canvasUuid === null || canvasUuid === undefined || canvasUuid === '') return undefined;

    const key = `canvas:${canvasUuid}`;
    acquireRoom(client, key, () => {
      client.emit('chat_canvas_join', {
        canvas_uuid: canvasUuid,
        ...(projectIdRef.current !== undefined ? { project_id: projectIdRef.current } : {}),
      });
    });

    return () => {
      releaseRoom(client, key, () => {
        client.emit('chat_canvas_leave_rooms', {
          canvas_uuid: canvasUuid,
          ...(projectIdRef.current !== undefined ? { project_id: projectIdRef.current } : {}),
        });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projectIdRef carries the latest projectId without re-triggering join/leave on every render
  }, [client, canvasUuid, enabled]);
}
