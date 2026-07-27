/**
 * events.ts is GENERATED (scripts/gen-socket-contract.mjs) — these tests
 * assert the generated output's runtime shape and invariants, not
 * generation mechanics (covered by scripts/lib/socket-contract-core.test.mjs).
 */
import { describe, expect, it } from 'vitest';

import { EVENTS_WITHOUT_SERVER_HANDLER, SOCKET_EVENTS, SOCKET_EVENT_NAMES } from './events';

describe('SOCKET_EVENT_NAMES', () => {
  it('catalogues exactly the 43 events from constants.js:881-936', () => {
    expect(SOCKET_EVENT_NAMES).toHaveLength(43);
    expect(new Set(SOCKET_EVENT_NAMES).size).toBe(43); // no duplicates
  });

  it('includes the full verbatim list from spec §5.5', () => {
    const expected = [
      'socket_validation_error', 'chat_predict', 'chat_continue_predict', 'application_continue_message',
      'chat_enter_room', 'chat_leave_rooms', 'chat_participant_delete', 'chat_message_delete',
      'chat_message_delete_all', 'chat_message_sync', 'chat_participant_update', 'chat_conversation_name_updated',
      'application_predict', 'application_leave_rooms', 'promptlib_predict', 'promptlib_leave_rooms',
      'notifications_notify', 'chat_canvas_join', 'chat_canvas_leave_rooms', 'chat_canvas_edit',
      'chat_canvas_sync', 'chat_canvas_error', 'chat_canvas_detail', 'chat_canvas_editor_joined',
      'chat_canvas_editors_change', 'chat_canvas_content_change', 'chat_predict_attachment', 'mcp_status',
      'test_mcp_connection', 'asr_start', 'asr_audio_chunk', 'asr_stop', 'asr_transcript_delta',
      'asr_transcript_done', 'asr_error', 'asr_speech_started', 'asr_vad_flush', 'tts_start', 'tts_stop',
      'tts_next', 'tts_audio_chunk', 'tts_done', 'tts_error',
    ];
    expect([...SOCKET_EVENT_NAMES].sort()).toEqual([...expected].sort());
  });
});

describe('SOCKET_EVENTS registry', () => {
  it('has exactly one entry per catalogued event name, each self-describing', () => {
    for (const name of SOCKET_EVENT_NAMES) {
      const contract = SOCKET_EVENTS[name];
      expect(contract.name).toBe(name);
      expect(['emit', 'receive', 'bidirectional']).toContain(contract.direction);
      expect(contract.evidence.length).toBeGreaterThan(0);
      expect(typeof contract.hasServerHandler).toBe('boolean');
      expect(typeof contract.serverEmits).toBe('boolean');
    }
  });

  it('every emit-capable event has a non-null emitSchema, every receive-capable event has a non-null receiveSchema', () => {
    for (const name of SOCKET_EVENT_NAMES) {
      const contract = SOCKET_EVENTS[name];
      if (contract.direction === 'emit' || contract.direction === 'bidirectional') {
        expect(contract.emitSchema).not.toBeNull();
      } else {
        expect(contract.emitSchema).toBeNull();
      }
      if (contract.direction === 'receive' || contract.direction === 'bidirectional') {
        expect(contract.receiveSchema).not.toBeNull();
      } else {
        expect(contract.receiveSchema).toBeNull();
      }
    }
  });

  it('reports exactly 13/43 events with a registered server handler — the documented research finding', () => {
    const withHandler = SOCKET_EVENT_NAMES.filter((n) => SOCKET_EVENTS[n].hasServerHandler);
    expect(withHandler).toHaveLength(13);
    expect([...withHandler].sort()).toEqual(
      [
        'chat_predict', 'chat_continue_predict', 'application_continue_message', 'chat_enter_room',
        'chat_leave_rooms', 'application_predict', 'application_leave_rooms', 'promptlib_predict',
        'promptlib_leave_rooms', 'chat_canvas_join', 'chat_canvas_leave_rooms', 'chat_canvas_edit',
        'test_mcp_connection',
      ].sort(),
    );
  });

  it('EVENTS_WITHOUT_SERVER_HANDLER is exactly the complement (30 events)', () => {
    expect(EVENTS_WITHOUT_SERVER_HANDLER).toHaveLength(30);
    for (const name of EVENTS_WITHOUT_SERVER_HANDLER) {
      expect(SOCKET_EVENTS[name].hasServerHandler).toBe(false);
    }
  });

  it('chat_canvas_editor_joined and chat_canvas_content_change have no registered handler but ARE server-emitted (the documented asymmetry)', () => {
    expect(SOCKET_EVENTS.chat_canvas_editor_joined.hasServerHandler).toBe(false);
    expect(SOCKET_EVENTS.chat_canvas_editor_joined.serverEmits).toBe(true);
    expect(SOCKET_EVENTS.chat_canvas_content_change.hasServerHandler).toBe(false);
    expect(SOCKET_EVENTS.chat_canvas_content_change.serverEmits).toBe(true);
  });
});

describe('payload schemas — spot checks against real evidence', () => {
  it('chat_predict emitSchema accepts the shape ChatBox.jsx:929 actually emits', () => {
    const schema = SOCKET_EVENTS.chat_predict.emitSchema;
    const result = schema.safeParse({ conversation_uuid: 'abc-123', content: 'hello' });
    expect(result.success).toBe(true);
  });

  it('chat_predict emitSchema is loose — tolerates extra fields (the real eventPayload carries many more)', () => {
    const schema = SOCKET_EVENTS.chat_predict.emitSchema;
    const result = schema.safeParse({ conversation_uuid: 'abc', extra_field_from_old_app: true });
    expect(result.success).toBe(true);
  });

  it('chat_predict receiveSchema (the shared stream envelope) requires only `type`, matching every destructure site (Chat/hooks.js:367-373)', () => {
    const schema = SOCKET_EVENTS.chat_predict.receiveSchema;
    expect(schema.safeParse({ type: 'agent_response' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false); // type is the one required field
  });

  it('mcp_status receiveSchema matches useMCPParticipantStatusMonitor.js:16 destructure', () => {
    const schema = SOCKET_EVENTS.mcp_status.receiveSchema;
    expect(schema.safeParse({ project_id: '1', connected: true, type: 'confluence' }).success).toBe(true);
  });

  it('asr_audio_chunk emit schema accepts an ArrayBuffer (PCM16, useStreamingSpeechRecognition.hooks.js:201-202)', () => {
    const schema = SOCKET_EVENTS.asr_audio_chunk.emitSchema;
    expect(schema.safeParse({ audio: new ArrayBuffer(8) }).success).toBe(true);
  });

  it('chat_leave_rooms emit schema accepts an array payload (Chat/hooks.js:73, emitLeaveRoom([streamId]))', () => {
    const schema = SOCKET_EVENTS.chat_leave_rooms.emitSchema;
    expect(schema.safeParse(['stream-1']).success).toBe(true);
    expect(schema.safeParse({ conversation_id: 'c1' }).success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it('test_mcp_connection emit schema matches useMcpAuthCheck.hooks.js:127-133', () => {
    const schema = SOCKET_EVENTS.test_mcp_connection.emitSchema;
    const result = schema.safeParse({
      stream_id: 's1',
      message_id: 'm1',
      project_id: 'p1',
      toolkit_config: { toolkit_id: 't1', toolkit_name: 'x', type: 'mcp', settings: {} },
      mcp_tokens: {},
    });
    expect(result.success).toBe(true);
  });
});
