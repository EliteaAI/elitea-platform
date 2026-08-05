/**
 * canvasSocket.test.ts — R-M1: uses `shared/api/socket/testing.ts`'s
 * in-memory `TestSocketClient` double, never `vi.mock()` on application
 * modules. Mirrors `shared/api/socket/rooms.test.ts`'s own
 * `withClient(client)` wrapper pattern.
 */
import { createElement, type ReactNode } from 'react';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient, type TestSocketClient } from '@/shared/api/socket/testing';

import {
  useCanvasContentChangeSocket,
  useCanvasDetailSocket,
  useCanvasEditSocket,
  useCanvasErrorSocket,
  useCanvasPresenceSocket,
  useCanvasSyncSocket,
} from './canvasSocket';

function withClient(client: TestSocketClient) {
  return ({ children }: { children: ReactNode }) => createElement(SocketClientContext.Provider, { value: client }, children);
}

describe('useCanvasEditSocket', () => {
  it('emits chat_canvas_edit with canvas_uuid/content and an optional project_id', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useCanvasEditSocket(), { wrapper: withClient(client) });

    act(() => result.current.sendChangeToRemote('canvas-1', 'new content', 'proj-1'));

    expect(client.getEmitted('chat_canvas_edit')).toEqual([
      { event: 'chat_canvas_edit', payload: { canvas_uuid: 'canvas-1', content: 'new content', project_id: 'proj-1' } },
    ]);
  });

  it('omits project_id entirely when not given', () => {
    const client = createTestSocketClient();
    const { result } = renderHook(() => useCanvasEditSocket(), { wrapper: withClient(client) });

    act(() => result.current.sendChangeToRemote('canvas-1', 'x'));

    expect(client.getEmitted('chat_canvas_edit')[0]?.payload).toEqual({ canvas_uuid: 'canvas-1', content: 'x' });
  });
});

describe('useCanvasSyncSocket', () => {
  it('subscribes on mount, unwraps message.content, and unsubscribes on unmount', () => {
    const client = createTestSocketClient();
    const onCanvasSync = vi.fn();
    const { unmount } = renderHook(() => useCanvasSyncSocket({ onCanvasSync }), { wrapper: withClient(client) });

    act(() => client.simulateServerEvent('chat_canvas_sync', { content: { uuid: 'canvas-1' } }));
    expect(onCanvasSync).toHaveBeenCalledWith({ uuid: 'canvas-1' });

    unmount();
    onCanvasSync.mockClear();
    act(() => client.simulateServerEvent('chat_canvas_sync', { content: { uuid: 'ignored' } }));
    expect(onCanvasSync).not.toHaveBeenCalled();
  });

  it('always forwards to the LATEST onCanvasSync without re-subscribing', () => {
    const client = createTestSocketClient();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onCanvasSync }) => useCanvasSyncSocket({ onCanvasSync }), {
      wrapper: withClient(client),
      initialProps: { onCanvasSync: first },
    });

    rerender({ onCanvasSync: second });
    act(() => client.simulateServerEvent('chat_canvas_sync', { content: 'x' }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });
});

describe('useCanvasErrorSocket', () => {
  it('forwards the raw (unwrapped) chat_canvas_error payload', () => {
    const client = createTestSocketClient();
    const onCanvasError = vi.fn();
    renderHook(() => useCanvasErrorSocket({ onCanvasError }), { wrapper: withClient(client) });

    act(() => client.simulateServerEvent('chat_canvas_error', { message: 'boom' }));

    expect(onCanvasError).toHaveBeenCalledWith({ message: 'boom' });
  });
});

describe('useCanvasDetailSocket', () => {
  it('unwraps message.content before forwarding', () => {
    const client = createTestSocketClient();
    const onCanvasDetail = vi.fn();
    renderHook(() => useCanvasDetailSocket({ onCanvasDetail }), { wrapper: withClient(client) });

    act(() => client.simulateServerEvent('chat_canvas_detail', { content: { uuid: 'canvas-2' } }));

    expect(onCanvasDetail).toHaveBeenCalledWith({ uuid: 'canvas-2' });
  });
});

describe('useCanvasContentChangeSocket', () => {
  it('forwards the raw broadcast payload with no unwrap', () => {
    const client = createTestSocketClient();
    const onCanvasContentChange = vi.fn();
    renderHook(() => useCanvasContentChangeSocket({ onCanvasContentChange }), { wrapper: withClient(client) });

    act(() => client.simulateServerEvent('chat_canvas_content_change', { canvas_uuid: 'canvas-1', data: 'x' }));

    expect(onCanvasContentChange).toHaveBeenCalledWith({ canvas_uuid: 'canvas-1', data: 'x' });
  });
});

describe('useCanvasPresenceSocket', () => {
  it('subscribes to BOTH chat_canvas_editor_joined and chat_canvas_editors_change from one hook call', () => {
    const client = createTestSocketClient();
    const onCanvasEditorJoined = vi.fn();
    const onCanvasEditorsChange = vi.fn();
    renderHook(() => useCanvasPresenceSocket({ onCanvasEditorJoined, onCanvasEditorsChange }), { wrapper: withClient(client) });

    act(() => client.simulateServerEvent('chat_canvas_editor_joined', { user_id: 'u-1' }));
    act(() => client.simulateServerEvent('chat_canvas_editors_change', { editors: [], canvas_uuid: 'c-1' }));

    expect(onCanvasEditorJoined).toHaveBeenCalledWith({ user_id: 'u-1' });
    expect(onCanvasEditorsChange).toHaveBeenCalledWith({ editors: [], canvas_uuid: 'c-1' });
  });

  it('unsubscribes both listeners on unmount', () => {
    const client = createTestSocketClient();
    const onCanvasEditorJoined = vi.fn();
    const onCanvasEditorsChange = vi.fn();
    const { unmount } = renderHook(() => useCanvasPresenceSocket({ onCanvasEditorJoined, onCanvasEditorsChange }), {
      wrapper: withClient(client),
    });

    unmount();
    act(() => client.simulateServerEvent('chat_canvas_editor_joined', { user_id: 'u-2' }));
    act(() => client.simulateServerEvent('chat_canvas_editors_change', { editors: [] }));

    expect(onCanvasEditorJoined).not.toHaveBeenCalled();
    expect(onCanvasEditorsChange).not.toHaveBeenCalled();
  });
});
