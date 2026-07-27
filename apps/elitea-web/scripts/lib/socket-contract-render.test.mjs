import { describe, expect, it } from 'vitest';

import { DISCRIMINANT_CATALOGUE, EVENT_CATALOGUE, renderEventsTs, renderMessagesTs } from './socket-contract-render.mjs';

/** Table-driven coverage of every decision this module makes (unit S5: same
 * 100%-of-decision-logic floor F2's scripts/lib/*-core.mjs modules carry). */

/** A cross-reference row for every catalogued event — renderEventsTs throws
 * unless every EVENT_CATALOGUE entry has a matching row. */
const FULL_CROSS_REFERENCE_ROWS = EVENT_CATALOGUE.map((e) => ({
  event: e.name,
  hasServerHandler: e.name !== 'chat_predict', // pick one false, so both Y/N render paths run
  serverEmits: e.name === 'chat_predict',
}));

describe('EVENT_CATALOGUE / DISCRIMINANT_CATALOGUE', () => {
  it('exports non-empty catalogues with the documented counts', () => {
    expect(EVENT_CATALOGUE.length).toBe(43);
    expect(DISCRIMINANT_CATALOGUE.length).toBe(34);
  });

  it('contains at least one entry with a note and at least one without', () => {
    expect(EVENT_CATALOGUE.some((e) => e.note)).toBe(true);
    expect(EVENT_CATALOGUE.some((e) => !e.note)).toBe(true);
  });

  it('contains events with both null and non-null emit/receive schemas', () => {
    expect(EVENT_CATALOGUE.some((e) => e.emitSchema === null)).toBe(true);
    expect(EVENT_CATALOGUE.some((e) => e.emitSchema !== null)).toBe(true);
    expect(EVENT_CATALOGUE.some((e) => e.receiveSchema === null)).toBe(true);
    expect(EVENT_CATALOGUE.some((e) => e.receiveSchema !== null)).toBe(true);
  });
});

describe('renderEventsTs', () => {
  it('renders every catalogued event into the registry when every row is present', () => {
    const out = renderEventsTs(FULL_CROSS_REFERENCE_ROWS);
    expect(out).toContain('export const SOCKET_EVENTS = {');
    expect(out).toContain('export const SOCKET_EVENT_NAMES = [');
    expect(out).toContain('chat_predict: {');
    expect(out).toContain("name: \"chat_predict\"");
    expect(out).toContain('export const EVENTS_WITHOUT_SERVER_HANDLER');
    // one event was pinned hasServerHandler:false above — its entry must say so
    expect(out).toContain('hasServerHandler: false');
    expect(out).toContain('hasServerHandler: true');
  });

  it('includes the shared schema preamble and every event name', () => {
    const out = renderEventsTs(FULL_CROSS_REFERENCE_ROWS);
    expect(out).toContain('const responseMetadataSchema');
    for (const e of EVENT_CATALOGUE) {
      expect(out).toContain(`"${e.name}"`);
    }
  });

  it('throws when a catalogued event has no matching cross-reference row', () => {
    const missingOne = FULL_CROSS_REFERENCE_ROWS.filter((r) => r.event !== EVENT_CATALOGUE[0].name);
    expect(() => renderEventsTs(missingOne)).toThrow(
      `renderEventsTs: no cross-reference row for event "${EVENT_CATALOGUE[0].name}"`,
    );
  });

  it('throws when given no rows at all', () => {
    expect(() => renderEventsTs([])).toThrow('renderEventsTs: no cross-reference row for event');
  });
});

describe('renderMessagesTs', () => {
  it('defaults to DISCRIMINANT_CATALOGUE when no catalogue argument is given', () => {
    const withDefault = renderMessagesTs();
    const withExplicit = renderMessagesTs(DISCRIMINANT_CATALOGUE);
    expect(withDefault).toBe(withExplicit);
  });

  it('renders one schema const and one discriminant literal per catalogue entry', () => {
    const out = renderMessagesTs();
    expect(out).toContain('export const SOCKET_MESSAGE_TYPES = [');
    expect(out).toContain('export const socketMessageSchema = z.discriminatedUnion');
    for (const d of DISCRIMINANT_CATALOGUE) {
      expect(out).toContain(`const ${d.key}MessageSchema = z.looseObject({`);
      expect(out).toContain(`type: z.literal(${JSON.stringify(d.value)}),`);
    }
  });

  it('applies the extra shape fields for a known discriminant shape (e.g. llmChunk)', () => {
    const out = renderMessagesTs([
      {
        key: 'AgentLlmChunk',
        value: 'agent_llm_chunk',
        evidence: ['test:1'],
        shape: 'llmChunk',
      },
    ]);
    expect(out).toContain('thinking: z.string().optional(),');
  });

  it('falls back to no extra fields for an unrecognised shape key (the ?? branch)', () => {
    const out = renderMessagesTs([
      {
        key: 'Mystery',
        value: 'mystery',
        evidence: ['test:1'],
        shape: 'thisShapeDoesNotExist',
      },
    ]);
    expect(out).toContain('const MysteryMessageSchema = z.looseObject({');
    // no extra field line was appended for the unknown shape
    expect(out).not.toContain('thinking:');
  });

  it('renders a NOTE line in the evidence comment when a catalogue entry carries one', () => {
    const out = renderMessagesTs([
      {
        key: 'Noted',
        value: 'noted',
        evidence: ['test:1'],
        shape: 'base',
        note: 'a distinguishing note for this discriminant',
      },
    ]);
    expect(out).toContain('NOTE: a distinguishing note for this discriminant');
  });

  it('omits the NOTE line when a catalogue entry has none', () => {
    const out = renderMessagesTs([
      { key: 'Plain', value: 'plain', evidence: ['test:1'], shape: 'base' },
    ]);
    expect(out).not.toContain('NOTE:');
  });

  it('handles an empty catalogue without throwing', () => {
    const out = renderMessagesTs([]);
    expect(out).toContain('export const SOCKET_MESSAGE_TYPES = [] as const;');
    expect(out).toContain('export const socketMessageSchema = z.discriminatedUnion(\'type\', [\n\n]);');
  });
});
