import { describe, expect, it } from 'vitest';

import type { ToolkitChatMessage } from '../../lib/hooks/useToolkitChat.types';

import { getMessageContentForCopy, resolveDefaultValue } from './TestTools.helpers';

function indexMessage(overrides: Partial<ToolkitChatMessage> = {}): ToolkitChatMessage {
  return {
    id: '1',
    role: 'assistant',
    content: 'base content',
    created_at: 0,
    participant_id: 'p1',
    ...overrides,
  };
}

describe('getMessageContentForCopy', () => {
  it('returns an empty string for an undefined message', () => {
    expect(getMessageContentForCopy(undefined)).toBe('');
  });

  it('stringifies a truthy exception, taking priority over content', () => {
    const message = indexMessage({ exception: { code: 'BOOM' }, content: 'ignored' });
    expect(getMessageContentForCopy(message)).toBe(JSON.stringify({ code: 'BOOM' }));
  });

  it('falls through to content when exception is present but falsy (e.g. null)', () => {
    const message = indexMessage({ exception: null, content: 'fallback content' });
    expect(getMessageContentForCopy(message)).toBe('fallback content');
  });

  it('joins messageItems content with a newline, skipping items whose content is empty/falsy', () => {
    const message = {
      ...indexMessage({ content: 'ignored-when-messageItems-present' }),
      messageItems: [{ content: 'first' }, { content: '' }, { content: 'second' }],
    } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('first\nsecond');
  });

  it('treats a non-string item content as empty (filtered out)', () => {
    const message = {
      ...indexMessage(),
      messageItems: [{ content: 'kept' }, { content: 42 }, { content: { nested: true } }],
    } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('kept');
  });

  it('treats a non-object item (null/primitive) as empty content', () => {
    const message = {
      ...indexMessage(),
      messageItems: [null, 'plain-string-item', 5, { content: 'valid' }],
    } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('valid');
  });

  it('treats an object item with no "content" key as empty', () => {
    const message = {
      ...indexMessage(),
      messageItems: [{ other: 'x' }, { content: 'valid' }],
    } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('valid');
  });

  it('falls through to content when messageItems is an empty array', () => {
    const message = {
      ...indexMessage({ content: 'from content field' }),
      messageItems: [],
    } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('from content field');
  });

  it('falls through to content when messageItems is entirely absent', () => {
    const message = indexMessage({ content: 'plain index message' });
    expect(getMessageContentForCopy(message)).toBe('plain index message');
  });

  it('returns the message content directly when neither exception nor messageItems apply', () => {
    const message = indexMessage({ content: 'direct content' });
    expect(getMessageContentForCopy(message)).toBe('direct content');
  });

  it('returns an empty string when content itself is nullish (?? fallback)', () => {
    const message = { ...indexMessage(), content: undefined } as unknown as ToolkitChatMessage;
    expect(getMessageContentForCopy(message)).toBe('');
  });
});

describe('resolveDefaultValue', () => {
  it('returns an explicit default as-is, even when falsy (0)', () => {
    expect(resolveDefaultValue({ default: 0, type: 'number' })).toBe(0);
  });

  it('returns an explicit default as-is, even when falsy (false)', () => {
    expect(resolveDefaultValue({ default: false, type: 'boolean' })).toBe(false);
  });

  it('returns an explicit default as-is, even when falsy (empty string)', () => {
    expect(resolveDefaultValue({ default: '', type: 'string' })).toBe('');
  });

  it('returns an explicit default over anyOf/type fallbacks', () => {
    expect(resolveDefaultValue({ default: ['x'], type: 'array', anyOf: [{ type: 'null' }] })).toEqual(['x']);
  });

  it('resolves an anyOf array-branch default when no top-level default is set', () => {
    expect(resolveDefaultValue({ anyOf: [{ type: 'string' }, { type: 'array', default: [1, 2] }] })).toEqual([1, 2]);
  });

  it('resolves null when an anyOf null-branch exists and no array-branch default is set', () => {
    expect(resolveDefaultValue({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBeNull();
  });

  it('prefers the anyOf array-branch default over an anyOf null branch when both are present', () => {
    expect(resolveDefaultValue({ anyOf: [{ type: 'null' }, { type: 'array', default: ['a'] }] })).toEqual(['a']);
  });

  it('falls back to the type-keyed default for "object" when anyOf yields nothing', () => {
    expect(resolveDefaultValue({ type: 'object' })).toEqual({});
  });

  it('falls back to the type-keyed default for "array"', () => {
    expect(resolveDefaultValue({ type: 'array' })).toEqual([]);
  });

  it('falls back to the type-keyed default for "boolean"', () => {
    expect(resolveDefaultValue({ type: 'boolean' })).toBe(false);
  });

  it('falls back to the type-keyed default for "string"', () => {
    expect(resolveDefaultValue({ type: 'string' })).toBe('');
  });

  it('falls back to null for "number"', () => {
    expect(resolveDefaultValue({ type: 'number' })).toBeNull();
  });

  it('falls back to null for "integer"', () => {
    expect(resolveDefaultValue({ type: 'integer' })).toBeNull();
  });

  it('falls back to an empty string when type is entirely absent', () => {
    expect(resolveDefaultValue({})).toBe('');
  });

  it('falls back to an empty string for an unrecognised type', () => {
    expect(resolveDefaultValue({ type: 'something-unknown' })).toBe('');
  });

  it('ignores an anyOf array-branch entry with no default of its own (falls through to null-branch / type default)', () => {
    expect(resolveDefaultValue({ anyOf: [{ type: 'array' }], type: 'string' })).toBe('');
  });
});
