/**
 * rooms.ts — declarative room membership. Uses testing.ts's in-memory
 * double (R-M1: never `vi.mock('socket.io-client')`) and asserts REAL
 * behaviour (what the hook actually emitted) rather than mock call
 * counts — this file IS the RED/GREEN proof (b) from the S5 brief.
 */
import { createElement, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SocketClientContext } from './client';
import { createTestSocketClient, type TestSocketClient } from './testing';
import { useCanvasRoom, useSocketRoom } from './rooms';

function withClient(client: TestSocketClient) {
  return ({ children }: { children: ReactNode }) => createElement(SocketClientContext.Provider, { value: client }, children);
}

describe('useSocketRoom', () => {
  it('emits chat_enter_room on mount with the given room id', () => {
    const client = createTestSocketClient();
    renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(client) });
    expect(client.getEmitted('chat_enter_room')).toEqual([{ event: 'chat_enter_room', payload: { conversation_id: 'conv-1' } }]);
  });

  it('RED/GREEN proof (b): emits chat_leave_rooms automatically on unmount — no manual cleanup call required', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(client) });

    expect(client.getEmitted('chat_leave_rooms')).toEqual([]); // not yet — still mounted

    unmount();

    expect(client.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: { conversation_id: 'conv-1' } }]);
  });

  it('leaves the OLD room and enters the NEW one when roomId changes, without a manual leave call from the caller', () => {
    const client = createTestSocketClient();
    const { rerender } = renderHook(({ roomId }: { roomId: string }) => useSocketRoom(roomId), {
      wrapper: withClient(client),
      initialProps: { roomId: 'conv-1' },
    });

    rerender({ roomId: 'conv-2' });

    const enters = client.getEmitted('chat_enter_room');
    const leaves = client.getEmitted('chat_leave_rooms');
    expect(enters.map((e) => e.payload)).toEqual([{ conversation_id: 'conv-1' }, { conversation_id: 'conv-2' }]);
    expect(leaves.map((e) => e.payload)).toEqual([{ conversation_id: 'conv-1' }]);
  });

  it('merges extra context fields into both the enter and leave payloads', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useSocketRoom('conv-1', { context: { project_id: 'proj-1' } }), {
      wrapper: withClient(client),
    });
    unmount();
    expect(client.getEmitted('chat_enter_room')[0]?.payload).toEqual({ conversation_id: 'conv-1', project_id: 'proj-1' });
    expect(client.getEmitted('chat_leave_rooms')[0]?.payload).toEqual({ conversation_id: 'conv-1', project_id: 'proj-1' });
  });

  it('does nothing when roomId is null/undefined/empty — and still nothing on unmount', () => {
    const client = createTestSocketClient();
    const { unmount, rerender } = renderHook(({ roomId }: { roomId: string | null }) => useSocketRoom(roomId), {
      wrapper: withClient(client),
      initialProps: { roomId: null as string | null },
    });
    rerender({ roomId: '' });
    unmount();
    expect(client.getEmitted()).toEqual([]);
  });

  it('does not enter when enabled:false, and entering later (enabled flips true) still guarantees a leave on unmount', () => {
    const client = createTestSocketClient();
    const { rerender, unmount } = renderHook(({ enabled }: { enabled: boolean }) => useSocketRoom('conv-1', { enabled }), {
      wrapper: withClient(client),
      initialProps: { enabled: false },
    });
    expect(client.getEmitted('chat_enter_room')).toEqual([]);

    rerender({ enabled: true });
    expect(client.getEmitted('chat_enter_room')).toHaveLength(1);

    unmount();
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });
});

describe('useSocketRoom — reference counting (post-review fix)', () => {
  // A leave handler need not honour the payload it receives: the Go
  // prototype server this behaviour was measured against (deleted with #126)
  // left EVERY room the socket connection had ever joined, not just the one
  // named in the event. An unconditional leave-on-unmount
  // would therefore let one subscriber's unmount silently evict a sibling
  // subscriber's still-mounted room on the same connection. Reproduces the
  // verifier's exact scenario.
  it('does NOT emit chat_leave_rooms when only ONE of two concurrent subscribers to the SAME room unmounts', () => {
    const client = createTestSocketClient();
    const first = renderHook(() => useSocketRoom('conv-shared'), { wrapper: withClient(client) });
    const second = renderHook(() => useSocketRoom('conv-shared'), { wrapper: withClient(client) });

    // Second subscriber joining the same room does not re-emit chat_enter_room.
    expect(client.getEmitted('chat_enter_room')).toEqual([{ event: 'chat_enter_room', payload: { conversation_id: 'conv-shared' } }]);

    first.unmount();

    expect(client.getEmitted('chat_leave_rooms')).toEqual([]); // the shared room must NOT be left — `second` is still mounted

    second.unmount();

    // Now that the LAST subscriber has unmounted, the leave fires — exactly once.
    expect(client.getEmitted('chat_leave_rooms')).toEqual([
      { event: 'chat_leave_rooms', payload: { conversation_id: 'conv-shared' } },
    ]);
  });

  it('the simple single-subscriber case still works: mount, unmount, leave fires exactly once', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(client) });
    unmount();
    expect(client.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: { conversation_id: 'conv-1' } }]);
  });

  it('three concurrent subscribers: only the third (last) unmount emits the leave', () => {
    const client = createTestSocketClient();
    const a = renderHook(() => useSocketRoom('conv-triple'), { wrapper: withClient(client) });
    const b = renderHook(() => useSocketRoom('conv-triple'), { wrapper: withClient(client) });
    const c = renderHook(() => useSocketRoom('conv-triple'), { wrapper: withClient(client) });

    a.unmount();
    expect(client.getEmitted('chat_leave_rooms')).toEqual([]);
    b.unmount();
    expect(client.getEmitted('chat_leave_rooms')).toEqual([]);
    c.unmount();
    expect(client.getEmitted('chat_leave_rooms')).toHaveLength(1);
  });

  it('subscribers to DIFFERENT rooms on the same client do not share a count', () => {
    const client = createTestSocketClient();
    const a = renderHook(() => useSocketRoom('conv-a'), { wrapper: withClient(client) });
    renderHook(() => useSocketRoom('conv-b'), { wrapper: withClient(client) });

    a.unmount();

    // conv-a's only subscriber left -> its leave fires; conv-b is untouched.
    expect(client.getEmitted('chat_leave_rooms')).toEqual([{ event: 'chat_leave_rooms', payload: { conversation_id: 'conv-a' } }]);
  });

  it('re-mounting after the count drops to zero re-enters the room (count is not permanently consumed)', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(client) });
    unmount();
    expect(client.getEmitted('chat_enter_room')).toHaveLength(1);

    renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(client) });
    expect(client.getEmitted('chat_enter_room')).toHaveLength(2);
  });

  it('the SAME roomId on a DIFFERENT client instance has an independent count (WeakMap is keyed per client)', () => {
    const clientA = createTestSocketClient();
    const clientB = createTestSocketClient();
    renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(clientA) });
    const onB = renderHook(() => useSocketRoom('conv-1'), { wrapper: withClient(clientB) });

    onB.unmount();

    expect(clientB.getEmitted('chat_leave_rooms')).toHaveLength(1); // B's only subscriber left
    expect(clientA.getEmitted('chat_leave_rooms')).toEqual([]); // A is untouched
  });
});

describe('useCanvasRoom', () => {
  it('emits chat_canvas_join on mount and chat_canvas_leave_rooms on unmount, with the canvas-specific payload shape', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useCanvasRoom('canvas-1', { projectId: 'proj-1' }), { wrapper: withClient(client) });

    expect(client.getEmitted('chat_canvas_join')).toEqual([
      { event: 'chat_canvas_join', payload: { canvas_uuid: 'canvas-1', project_id: 'proj-1' } },
    ]);

    unmount();

    expect(client.getEmitted('chat_canvas_leave_rooms')).toEqual([
      { event: 'chat_canvas_leave_rooms', payload: { canvas_uuid: 'canvas-1', project_id: 'proj-1' } },
    ]);
  });

  it('does nothing for a null canvasUuid', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useCanvasRoom(null), { wrapper: withClient(client) });
    unmount();
    expect(client.getEmitted()).toEqual([]);
  });

  it('omits project_id from the payload entirely when no projectId option is given', () => {
    const client = createTestSocketClient();
    const { unmount } = renderHook(() => useCanvasRoom('canvas-2'), { wrapper: withClient(client) });
    expect(client.getEmitted('chat_canvas_join')[0]?.payload).toEqual({ canvas_uuid: 'canvas-2' });
    unmount();
    expect(client.getEmitted('chat_canvas_leave_rooms')[0]?.payload).toEqual({ canvas_uuid: 'canvas-2' });
  });

  it('reference counting: does NOT leave the shared canvas room while a sibling subscriber is still mounted', () => {
    const client = createTestSocketClient();
    const first = renderHook(() => useCanvasRoom('canvas-shared'), { wrapper: withClient(client) });
    const second = renderHook(() => useCanvasRoom('canvas-shared'), { wrapper: withClient(client) });

    expect(client.getEmitted('chat_canvas_join')).toHaveLength(1);

    first.unmount();
    expect(client.getEmitted('chat_canvas_leave_rooms')).toEqual([]);

    second.unmount();
    expect(client.getEmitted('chat_canvas_leave_rooms')).toEqual([
      { event: 'chat_canvas_leave_rooms', payload: { canvas_uuid: 'canvas-shared' } },
    ]);
  });
});
