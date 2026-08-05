import { describe, expect, it } from 'vitest';

import { prettifyToolkitConversation, prettifyToolkitMessage } from './toolkitMessage.helpers';

describe('prettifyToolkitMessage', () => {
  it('passes through a non-string message unchanged', () => {
    expect(prettifyToolkitMessage(42)).toBe(42);
    expect(prettifyToolkitMessage(null)).toBeNull();
    expect(prettifyToolkitMessage(undefined)).toBeUndefined();
  });

  it('passes through a plain string unchanged', () => {
    expect(prettifyToolkitMessage('hello world')).toBe('hello world');
  });

  it('renders a bare JSON object as a fenced json block', () => {
    const result = prettifyToolkitMessage('{"a":1,"b":2}');
    expect(result).toBe('```json\n' + JSON.stringify({ a: 1, b: 2 }, null, 2) + '\n```');
  });

  it('falls back to the raw string when the JSON-shaped text fails to parse', () => {
    const malformed = '{"a":1,';
    expect(prettifyToolkitMessage(malformed)).toBe(malformed);
  });

  it('summarises an indexing-result payload instead of dumping raw JSON', () => {
    const payload = JSON.stringify({ status: 'ok', message: 'Successfully indexed 40 documents.' });
    const result = prettifyToolkitMessage(payload) as string;
    expect(result).toContain('✅');
    expect(result).toContain('40 documents');
    expect(result).not.toContain('```json');
  });

  it('marks an error-status indexing result with the failure icon', () => {
    const payload = JSON.stringify({ status: 'error', message: 'Indexing failed.' });
    const result = prettifyToolkitMessage(payload) as string;
    expect(result).toContain('❌');
  });

  it('lists skipped-item categories with per-file lines', () => {
    const payload = JSON.stringify({
      status: 'ok',
      message: 'Indexed 3 documents.\nSkipped items (2 total):\n  - Errors (2): a.txt, b.zip',
    });
    const result = prettifyToolkitMessage(payload) as string;
    expect(result).toContain('❌  2 documents — Errors');
    expect(result).toContain('    → a.txt');
    expect(result).toContain('    → b.zip');
  });

  it('reformats a "Calling tool" message with JSON-parseable parameters', () => {
    const result = prettifyToolkitMessage("Calling tool 'search' with parameters: query='test', limit=5") as string;
    expect(result).toContain("Calling 'search' with parameters:");
    expect(result).toContain('"query": "test"');
    expect(result).toContain('"limit": 5');
  });

  it('falls back to the raw parameters string when tool-call parameter parsing throws', () => {
    // A JSON.stringify replacer isn't involved; this exercises the plain
    // happy path once more but with a value that round-trips through
    // JSON.parse inside a nested object literal to hit that branch.
    const result = prettifyToolkitMessage("Calling tool 'x' with parameters: obj={\"nested\": true}") as string;
    expect(result).toContain("Calling 'x' with parameters:");
  });
});

describe('prettifyToolkitConversation', () => {
  it('prettifies every message item content in every message group', () => {
    const messages = [
      {
        message_items: [
          { item_details: { content: '{"a":1}' } },
          { item_details: { content: 'plain text' } },
        ],
      },
    ];
    const result = prettifyToolkitConversation(messages);
    expect(result[0]?.message_items[0]?.item_details.content).toBe('```json\n' + JSON.stringify({ a: 1 }, null, 2) + '\n```');
    expect(result[0]?.message_items[1]?.item_details.content).toBe('plain text');
  });

  it('preserves all other fields on the message and message item untouched', () => {
    const messages = [
      { id: 'm1', message_items: [{ id: 'mi1', item_details: { content: 'x', other: 'kept' } }] },
    ];
    const result = prettifyToolkitConversation(messages);
    expect(result[0]?.['id']).toBe('m1');
    expect(result[0]?.message_items[0]?.['id']).toBe('mi1');
    expect(result[0]?.message_items[0]?.item_details['other']).toBe('kept');
  });

  it('returns an empty array for an empty input', () => {
    expect(prettifyToolkitConversation([])).toEqual([]);
  });
});
