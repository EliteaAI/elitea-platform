/**
 * testing.ts — the in-memory socket double (R-M1 sanctioned exception,
 * §6.2). These tests prove the double faithfully implements the
 * SocketClient contract on its own, independent of client.ts.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createTestSocketClient } from './testing';
import type { EmitPayloadOf } from './events';

describe('createTestSocketClient', () => {
  it('is a factory: two calls produce two independent doubles', () => {
    const a = createTestSocketClient();
    const b = createTestSocketClient();
    a.setConnectionState('connected');
    expect(a.getConnectionState()).toBe('connected');
    expect(b.getConnectionState()).toBe('connecting');
  });

  it('starts in the "connecting" state, matching createSocketClient', () => {
    expect(createTestSocketClient().getConnectionState()).toBe('connecting');
  });

  describe('emit / getEmitted', () => {
    it('records every emit in call order, retrievable and filterable', () => {
      const client = createTestSocketClient();
      client.emit('chat_enter_room', { conversation_id: 'c1' });
      client.emit('chat_leave_rooms', { conversation_id: 'c1' });
      client.emit('chat_enter_room', { conversation_id: 'c2' });

      expect(client.getEmitted()).toHaveLength(3);
      expect(client.getEmitted('chat_enter_room')).toEqual([
        { event: 'chat_enter_room', payload: { conversation_id: 'c1' } },
        { event: 'chat_enter_room', payload: { conversation_id: 'c2' } },
      ]);
    });

    it('clearEmitted() resets the recorded history without touching listeners or connection state', () => {
      const client = createTestSocketClient();
      client.emit('chat_leave_rooms', {});
      client.setConnectionState('connected');
      client.clearEmitted();
      expect(client.getEmitted()).toEqual([]);
      expect(client.getConnectionState()).toBe('connected');
    });

    it('warns but still records on a schema-invalid emit payload — same contract as client.ts', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const client = createTestSocketClient();
      const malformed = 'not-an-object' as unknown as EmitPayloadOf<'chat_canvas_join'>;
      client.emit('chat_canvas_join', malformed);
      expect(warnSpy).toHaveBeenCalled();
      expect(client.getEmitted()).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it('returns false from emit() after disconnect() — mirrors "no socket to write to"', () => {
      const client = createTestSocketClient();
      client.disconnect();
      expect(client.emit('chat_leave_rooms', {})).toBe(false);
    });
  });

  describe('simulateServerEvent / on / off', () => {
    it('drives a registered handler with the given payload', () => {
      const client = createTestSocketClient();
      const received: unknown[] = [];
      client.on('mcp_status', (p) => received.push(p));
      client.simulateServerEvent('mcp_status', { project_id: 'p1', connected: false, type: 'jira' });
      expect(received).toEqual([{ project_id: 'p1', connected: false, type: 'jira' }]);
    });

    it('drives every listener registered for the same event', () => {
      const client = createTestSocketClient();
      let a = 0;
      let b = 0;
      client.on('notifications_notify', () => {
        a++;
      });
      client.on('notifications_notify', () => {
        b++;
      });
      client.simulateServerEvent('notifications_notify', undefined);
      expect(a).toBe(1);
      expect(b).toBe(1);
    });

    it('off() stops further deliveries to that handler', () => {
      const client = createTestSocketClient();
      const received: unknown[] = [];
      const handler = (p: unknown): void => {
        received.push(p);
      };
      client.on('notifications_notify', handler);
      client.simulateServerEvent('notifications_notify', undefined);
      client.off('notifications_notify', handler);
      client.simulateServerEvent('notifications_notify', undefined);
      expect(received).toHaveLength(1);
    });

    it('simulating an event with no listeners is a safe no-op', () => {
      const client = createTestSocketClient();
      expect(() => client.simulateServerEvent('asr_error', { error: 'boom' })).not.toThrow();
    });

    it('warns but still delivers on a schema-invalid simulated payload', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const client = createTestSocketClient();
      const received: unknown[] = [];
      client.on('asr_transcript_delta', (p) => received.push(p));
      client.simulateServerEvent('asr_transcript_delta', { delta: 123 } as never);
      expect(warnSpy).toHaveBeenCalled();
      expect(received).toHaveLength(1);
      warnSpy.mockRestore();
    });
  });

  describe('useConnectionState — reactive hook', () => {
    it('reflects setConnectionState transitions', () => {
      const client = createTestSocketClient();
      const { result } = renderHook(() => client.useConnectionState());
      expect(result.current).toBe('connecting');
      act(() => {
        client.setConnectionState('reconnecting');
      });
      expect(result.current).toBe('reconnecting');
    });
  });

  describe('disconnect()', () => {
    it('sets the connection state to disconnected', () => {
      const client = createTestSocketClient();
      client.setConnectionState('connected');
      client.disconnect();
      expect(client.getConnectionState()).toBe('disconnected');
    });
  });

  it('exposes a `socket` field satisfying the SocketClient shape (escape hatch), even though it is a stub', () => {
    const client = createTestSocketClient();
    expect(client.socket).toBeDefined();
  });
});
