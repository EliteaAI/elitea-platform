import { describe, expect, it } from 'vitest';

import { parseMentionRanges } from './instructionsMention.utils';
import type { MentionableItem } from './instructionsMention.utils';

describe('parseMentionRanges', () => {
  it('returns [] for empty text or no mentionable items', () => {
    expect(parseMentionRanges('', [{ name: 'foo' }])).toEqual([]);
    expect(parseMentionRanges('~foo', undefined)).toEqual([]);
    expect(parseMentionRanges('~foo', [])).toEqual([]);
  });

  it('finds a single "~"-triggered mention at start of text', () => {
    const items: MentionableItem[] = [{ name: 'summarize' }];
    expect(parseMentionRanges('~summarize please', items, '~')).toEqual([{ start: 0, end: 10 }]);
  });

  it('requires the trigger to be preceded by whitespace or start-of-text', () => {
    const items: MentionableItem[] = [{ name: 'foo' }];
    expect(parseMentionRanges('x~foo', items, '~')).toEqual([]);
    expect(parseMentionRanges(' ~foo', items, '~')).toEqual([{ start: 1, end: 5 }]);
  });

  it('longest name wins when a shorter name is a prefix of a longer one', () => {
    const items: MentionableItem[] = [{ name: 'foo' }, { name: 'foobar' }];
    // "~foobar" should highlight the full "foobar", not just "foo".
    expect(parseMentionRanges('~foobar', items, '~')).toEqual([{ start: 0, end: 7 }]);
  });

  it('finds multiple non-overlapping mentions', () => {
    const items: MentionableItem[] = [{ name: 'alpha' }, { name: 'beta' }];
    const ranges = parseMentionRanges('~alpha and ~beta', items, '~');
    expect(ranges).toEqual([
      { start: 0, end: 6 },
      { start: 11, end: 16 },
    ]);
  });

  it('does not match a partial-word occurrence (must end at whitespace/trigger/end-of-text)', () => {
    const items: MentionableItem[] = [{ name: 'foo' }];
    // "~foobar" — the token "foo" is present but immediately followed by "bar",
    // not whitespace/end — must not highlight just "~foo".
    expect(parseMentionRanges('~foobar', items, '~')).toEqual([]);
  });

  it('toolkit items ("/" or "#" separator) extend the highlight to a valid tool name', () => {
    const items: MentionableItem[] = [
      { name: 'github', isToolkit: true, type: 'github', settings: { selected_tools: ['create_issue'] } },
    ];
    expect(parseMentionRanges('/github/create_issue', items, '/')).toEqual([{ start: 0, end: 20 }]);
  });

  it('toolkit items skip the occurrence entirely when the tool name is not valid', () => {
    const items: MentionableItem[] = [
      { name: 'github', isToolkit: true, type: 'github', settings: { selected_tools: ['create_issue'] } },
    ];
    expect(parseMentionRanges('/github/not_a_real_tool', items, '/')).toEqual([]);
  });

  it('toolkit item with a separator but no tool name highlights the toolkit name only', () => {
    const items: MentionableItem[] = [{ name: 'github', isToolkit: true }];
    expect(parseMentionRanges('/github/', items, '/')).toEqual([{ start: 0, end: 7 }]);
  });

  it('an MCP toolkit item validates against available_mcp_tools (value or label)', () => {
    const items: MentionableItem[] = [
      {
        name: 'my-mcp',
        isToolkit: true,
        type: 'mcp',
        settings: { available_mcp_tools: [{ value: 'search' }, { label: 'browse' }] },
      },
    ];
    expect(parseMentionRanges('/my-mcp/search', items, '/')).toEqual([{ start: 0, end: 14 }]);
    expect(parseMentionRanges('/my-mcp/browse', items, '/')).toEqual([{ start: 0, end: 14 }]);
    expect(parseMentionRanges('/my-mcp/unknown', items, '/')).toEqual([]);
  });

  it('a toolkit item with no settings accepts any tool name (validation not possible)', () => {
    const items: MentionableItem[] = [{ name: 'github', isToolkit: true }];
    expect(parseMentionRanges('/github/anything', items, '/')).toEqual([{ start: 0, end: 16 }]);
  });

  it('defaults triggerChar to "/"', () => {
    const items: MentionableItem[] = [{ name: 'foo' }];
    expect(parseMentionRanges('/foo', items)).toEqual([{ start: 0, end: 4 }]);
  });
});
