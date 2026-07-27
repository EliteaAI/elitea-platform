import { describe, expect, it } from 'vitest';

import {
  RESERVED_SOCKET_IO_EVENTS,
  crossReferenceEvents,
  diffAgainstAllowlist,
  diffCatalogueCompleteness,
  parseFlatStringObject,
  parseServerEmits,
  parseServerOnHandlers,
  parseSioEvents,
  parseSocketMessageTypes,
  renderCoverageReport,
} from './socket-contract-core.mjs';

const FIXTURE_CONSTANTS_JS = `
export const unrelated = {
  foo: 'bar',
};

export const sioEvents = {
  chat_predict: 'chat_predict',
  chat_enter_room: 'chat_enter_room',

  // a comment line inside the block, and a blank line above, must be skipped
  chat_leave_rooms: 'chat_leave_rooms',
};

export const SocketMessageType = {
  AgentStart: 'agent_start',
  AgentResponse: 'agent_response',
};
`;

const FIXTURE_SERVER_GO = `package socketio

func (s *Server) registerHandlers(client *sio.Socket) {
	_ = client.On("chat_enter_room", func(args ...any) {
		s.handleEnterRoom(client, args)
	})

	_ = client.On("chat_leave_rooms", func(args ...any) {
		s.handleLeaveRooms(client, args)
	})

	_ = client.On("disconnect", func(args ...any) {
		s.rooms.removeClient(string(client.Id()))
	})
}

func (s *Server) handleChatPredict(client *sio.Socket) {
	_ = s.io.To(sio.Room("x")).Emit("chat_predict", payload)
	_ = client.Emit("chat_predict", payload)
}
`;

describe('parseFlatStringObject', () => {
  it('extracts KEY: value entries in source order with 1-based line numbers', () => {
    const entries = parseFlatStringObject(FIXTURE_CONSTANTS_JS, 'sioEvents');
    expect(entries).toEqual([
      { key: 'chat_predict', value: 'chat_predict', line: 7 },
      { key: 'chat_enter_room', value: 'chat_enter_room', line: 8 },
      { key: 'chat_leave_rooms', value: 'chat_leave_rooms', line: 11 },
    ]);
  });

  it('does not bleed into a different object literal earlier in the file', () => {
    const entries = parseFlatStringObject(FIXTURE_CONSTANTS_JS, 'sioEvents');
    expect(entries.some((e) => e.key === 'foo')).toBe(false);
  });

  it('parses a second, independent block (SocketMessageType) correctly', () => {
    const entries = parseFlatStringObject(FIXTURE_CONSTANTS_JS, 'SocketMessageType');
    expect(entries).toEqual([
      { key: 'AgentStart', value: 'agent_start', line: 15 },
      { key: 'AgentResponse', value: 'agent_response', line: 16 },
    ]);
  });

  it('throws when the named export is not found', () => {
    expect(() => parseFlatStringObject(FIXTURE_CONSTANTS_JS, 'nope')).toThrow(/could not find/);
  });

  it('throws when the block is never terminated', () => {
    const broken = "export const sioEvents = {\n  a: 'b',\n";
    expect(() => parseFlatStringObject(broken, 'sioEvents')).toThrow(/unterminated/);
  });

  it('parseSioEvents / parseSocketMessageTypes are thin named wrappers', () => {
    expect(parseSioEvents(FIXTURE_CONSTANTS_JS)).toHaveLength(3);
    expect(parseSocketMessageTypes(FIXTURE_CONSTANTS_JS)).toHaveLength(2);
  });
});

describe('parseServerOnHandlers / parseServerEmits', () => {
  it('finds every client.On(...) registration with its line number, deduped, in source order', () => {
    expect(parseServerOnHandlers(FIXTURE_SERVER_GO)).toEqual([
      { event: 'chat_enter_room', line: 4 },
      { event: 'chat_leave_rooms', line: 8 },
      { event: 'disconnect', line: 12 },
    ]);
  });

  it('finds every .Emit(...) call site, deduped, in source order', () => {
    expect(parseServerEmits(FIXTURE_SERVER_GO)).toEqual([{ event: 'chat_predict', line: 18 }]);
  });

  it('dedupes a repeated registration on the SAME event to its first line', () => {
    const src = 'client.On("x", a)\nclient.On("x", b)\n';
    expect(parseServerOnHandlers(src)).toEqual([{ event: 'x', line: 1 }]);
  });

  it('returns an empty array when there are no matches', () => {
    expect(parseServerOnHandlers('package socketio\n')).toEqual([]);
    expect(parseServerEmits('package socketio\n')).toEqual([]);
  });
});

describe('RESERVED_SOCKET_IO_EVENTS', () => {
  it('contains the socket.io transport-lifecycle events, not application events', () => {
    expect(RESERVED_SOCKET_IO_EVENTS.has('disconnect')).toBe(true);
    expect(RESERVED_SOCKET_IO_EVENTS.has('connect')).toBe(true);
    expect(RESERVED_SOCKET_IO_EVENTS.has('chat_predict')).toBe(false);
  });
});

describe('crossReferenceEvents', () => {
  const clientEvents = ['chat_predict', 'chat_enter_room', 'chat_leave_rooms'];

  it('flags hasServerHandler true only for events with a client.On registration', () => {
    const onHandlers = parseServerOnHandlers(FIXTURE_SERVER_GO);
    const emits = parseServerEmits(FIXTURE_SERVER_GO);
    const { rows } = crossReferenceEvents(clientEvents, onHandlers, emits);
    expect(rows).toEqual([
      { event: 'chat_predict', hasServerHandler: false, serverEmits: true },
      { event: 'chat_enter_room', hasServerHandler: true, serverEmits: false },
      { event: 'chat_leave_rooms', hasServerHandler: true, serverEmits: false },
    ]);
  });

  it('excludes reserved socket.io events (disconnect) from serverOnlyHandlers', () => {
    const onHandlers = parseServerOnHandlers(FIXTURE_SERVER_GO);
    const { serverOnlyHandlers } = crossReferenceEvents(clientEvents, onHandlers, []);
    expect(serverOnlyHandlers).toEqual([]);
  });

  it('reports a genuine server-only handler (an event the client never catalogues)', () => {
    const onHandlers = [{ event: 'mystery_event', line: 1 }];
    const { serverOnlyHandlers } = crossReferenceEvents(clientEvents, onHandlers, []);
    expect(serverOnlyHandlers).toEqual(['mystery_event']);
  });
});

describe('diffAgainstAllowlist', () => {
  const crossReference = {
    rows: [
      { event: 'a', hasServerHandler: true },
      { event: 'b', hasServerHandler: false },
      { event: 'c', hasServerHandler: false },
    ],
    serverOnlyHandlers: ['d'],
  };

  it('is ok when every gap is allow-listed and no allow-list entry is stale', () => {
    const allowlist = {
      knownGaps: [
        { event: 'b', direction: 'client-only' },
        { event: 'c', direction: 'client-only' },
        { event: 'd', direction: 'server-only' },
      ],
    };
    const diff = diffAgainstAllowlist(crossReference, allowlist);
    expect(diff.ok).toBe(true);
    expect(diff.newClientOnlyGaps).toEqual([]);
    expect(diff.newServerOnlyGaps).toEqual([]);
    expect(diff.staleEntries).toEqual([]);
  });

  it('RED: fails and names a NEW client-only gap that has no allow-list entry', () => {
    const allowlist = { knownGaps: [{ event: 'c', direction: 'client-only' }, { event: 'd', direction: 'server-only' }] };
    const diff = diffAgainstAllowlist(crossReference, allowlist);
    expect(diff.ok).toBe(false);
    expect(diff.newClientOnlyGaps).toEqual(['b']);
  });

  it('fails and names a NEW server-only gap that has no allow-list entry', () => {
    const allowlist = { knownGaps: [{ event: 'b', direction: 'client-only' }, { event: 'c', direction: 'client-only' }] };
    const diff = diffAgainstAllowlist(crossReference, allowlist);
    expect(diff.ok).toBe(false);
    expect(diff.newServerOnlyGaps).toEqual(['d']);
  });

  it('fails on a STALE allow-list entry — a listed gap that is no longer real', () => {
    const allowlist = {
      knownGaps: [
        { event: 'b', direction: 'client-only' },
        { event: 'c', direction: 'client-only' },
        { event: 'd', direction: 'server-only' },
        { event: 'a', direction: 'client-only' }, // 'a' HAS a server handler now — stale
      ],
    };
    const diff = diffAgainstAllowlist(crossReference, allowlist);
    expect(diff.ok).toBe(false);
    expect(diff.staleEntries).toEqual([{ event: 'a', direction: 'client-only' }]);
  });
});

describe('diffCatalogueCompleteness', () => {
  it('is ok when the parsed and catalogue name sets are identical', () => {
    expect(diffCatalogueCompleteness(['a', 'b'], ['b', 'a']).ok).toBe(true);
  });

  it('reports a name present in the source but missing from the catalogue', () => {
    const result = diffCatalogueCompleteness(['a', 'b', 'c'], ['a', 'b']);
    expect(result.ok).toBe(false);
    expect(result.missingFromCatalogue).toEqual(['c']);
    expect(result.extraInCatalogue).toEqual([]);
  });

  it('reports a name present in the catalogue but no longer in the source (stale catalogue entry)', () => {
    const result = diffCatalogueCompleteness(['a'], ['a', 'zombie']);
    expect(result.ok).toBe(false);
    expect(result.extraInCatalogue).toEqual(['zombie']);
  });
});

describe('renderCoverageReport', () => {
  it('renders one row per catalogue entry with Y/N flags and a status column', () => {
    const catalogue = [
      { name: 'a', direction: 'emit' },
      { name: 'b', direction: 'receive' },
    ];
    const crossReference = {
      rows: [
        { event: 'a', hasServerHandler: true, serverEmits: false },
        { event: 'b', hasServerHandler: false, serverEmits: false },
      ],
    };
    const diff = { clientOnlyGaps: ['b'], newClientOnlyGaps: [] };
    const report = renderCoverageReport(catalogue, crossReference, diff);
    expect(report).toContain('a');
    expect(report).toContain('OK');
    expect(report).toContain('known gap (allow-listed)');
    expect(report).toContain('1/2 events have a registered server handler');
  });

  it('labels an unreviewed gap distinctly from a known one', () => {
    const catalogue = [{ name: 'b', direction: 'receive' }];
    const crossReference = { rows: [{ event: 'b', hasServerHandler: false, serverEmits: false }] };
    const diff = { clientOnlyGaps: ['b'], newClientOnlyGaps: ['b'] };
    const report = renderCoverageReport(catalogue, crossReference, diff);
    expect(report).toContain('NEW GAP (unreviewed)');
  });
});
