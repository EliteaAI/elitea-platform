import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import {
  createMentionCmExtension,
  getItemDescription,
  isToolkitItem,
  parseMentionRanges,
  type MentionableItem,
} from './instructionsMention.utils';

describe('isToolkitItem', () => {
  it('is false for an application-type tool (sub-agent/pipeline)', () => {
    expect(isToolkitItem({ name: 'Sub', type: 'application' })).toBe(false);
  });

  it('is true for a toolkit/MCP-type tool', () => {
    expect(isToolkitItem({ name: 'Github', type: 'github' })).toBe(true);
    expect(isToolkitItem({ name: 'Remote', type: 'mcp' })).toBe(true);
  });
});

describe('getItemDescription', () => {
  it('labels a pipeline sub-application', () => {
    expect(getItemDescription({ name: 'P', type: 'application', agent_type: 'pipeline' })).toBe('Pipeline');
  });

  it('labels a non-pipeline sub-application as Agent', () => {
    expect(getItemDescription({ name: 'A', type: 'application' })).toBe('Agent');
    expect(getItemDescription({ name: 'A', type: 'application', agent_type: 'chat' })).toBe('Agent');
  });

  it('labels anything else as Toolkit', () => {
    expect(getItemDescription({ name: 'Github', type: 'github' })).toBe('Toolkit');
  });
});

describe('parseMentionRanges', () => {
  it('returns [] for empty text or no items', () => {
    expect(parseMentionRanges('', [{ name: 'A' }])).toStrictEqual([]);
    expect(parseMentionRanges('/A', undefined)).toStrictEqual([]);
    expect(parseMentionRanges('/A', [])).toStrictEqual([]);
  });

  it('matches a bare agent/pipeline mention at start of text', () => {
    const items: MentionableItem[] = [{ name: 'MyAgent', isToolkit: false }];
    expect(parseMentionRanges('/MyAgent do the thing', items)).toStrictEqual([{ start: 0, end: 8 }]);
  });

  it('requires whitespace or start-of-text before the trigger (no match mid-word)', () => {
    const items: MentionableItem[] = [{ name: 'Agent', isToolkit: false }];
    expect(parseMentionRanges('x/Agent', items)).toStrictEqual([]);
  });

  it('extends the range to a valid tool name for a toolkit mention', () => {
    const items: MentionableItem[] = [
      { name: 'Github', isToolkit: true, settings: { selected_tools: ['create_issue'] } },
    ];
    // "/Github/create_issue " -> highlight "/Github/create_issue"
    expect(parseMentionRanges('/Github/create_issue please', items)).toStrictEqual([{ start: 0, end: 20 }]);
  });

  it('skips the occurrence entirely (no highlight at all) when the following tool name is not valid for that toolkit', () => {
    const items: MentionableItem[] = [
      { name: 'Github', isToolkit: true, settings: { selected_tools: ['create_issue'] } },
    ];
    expect(parseMentionRanges('/Github/bogus_tool', items)).toStrictEqual([]);
  });

  it('highlights the toolkit name only when the separator has no following tool name', () => {
    const items: MentionableItem[] = [{ name: 'Github', isToolkit: true, settings: {} }];
    expect(parseMentionRanges('/Github/', items)).toStrictEqual([{ start: 0, end: 7 }]);
  });

  it('supports "#" as an alternate toolkit/tool separator', () => {
    const items: MentionableItem[] = [
      { name: 'Github', isToolkit: true, settings: { selected_tools: ['create_issue'] } },
    ];
    expect(parseMentionRanges('/Github#create_issue', items)).toStrictEqual([{ start: 0, end: 20 }]);
  });

  it('prefers the longest matching name so a shorter prefix does not shadow a longer one', () => {
    const items: MentionableItem[] = [
      { name: 'Git', isToolkit: false },
      { name: 'GitHub', isToolkit: false },
    ];
    // Only the longer "/GitHub" should be highlighted, not a spurious "/Git" overlap.
    const ranges = parseMentionRanges('/GitHub ', items);
    expect(ranges).toStrictEqual([{ start: 0, end: 7 }]);
  });

  it('resolves an MCP item\'s valid tool names from available_mcp_tools (value or label)', () => {
    const items: MentionableItem[] = [
      {
        name: 'Remote',
        type: 'mcp',
        isToolkit: true,
        settings: { available_mcp_tools: [{ value: 'search' }, { label: 'fetch' }] },
      },
    ];
    expect(parseMentionRanges('/Remote/search', items)).toStrictEqual([{ start: 0, end: 14 }]);
    expect(parseMentionRanges('/Remote/fetch', items)).toStrictEqual([{ start: 0, end: 13 }]);
  });

  it('sorts overlapping-free ranges ascending by start position', () => {
    const items: MentionableItem[] = [
      { name: 'Alpha', isToolkit: false },
      { name: 'Beta', isToolkit: false },
    ];
    const ranges = parseMentionRanges('/Beta then /Alpha', items);
    expect(ranges).toStrictEqual([
      { start: 0, end: 5 },
      { start: 11, end: 17 },
    ]);
  });
});

describe('createMentionCmExtension', () => {
  it('returns an empty extension list when there are no mentionable items', () => {
    expect(createMentionCmExtension(undefined, 'var(--el-text-info)')).toStrictEqual([]);
    expect(createMentionCmExtension([], 'var(--el-text-info)')).toStrictEqual([]);
  });

  it('builds a working CodeMirror extension that decorates a mention range', () => {
    const items: MentionableItem[] = [{ name: 'MyAgent', isToolkit: false }];
    const extensions = createMentionCmExtension(items, 'var(--el-text-info)');
    expect(extensions.length).toBe(2);

    const state = EditorState.create({ doc: '/MyAgent hello', extensions: extensions as never });
    const field = extensions[1];
    expect(field).toBeDefined();
    // The StateField's create() ran during EditorState.create — reading it back proves the
    // decoration set was built without throwing and is non-empty for a matching mention.
    const decorations = state.field(field as never) as { size: number };
    expect(decorations.size).toBeGreaterThan(0);
  });

  it('recomputes decorations only when the document actually changes', () => {
    const items: MentionableItem[] = [{ name: 'MyAgent', isToolkit: false }];
    const extensions = createMentionCmExtension(items, 'var(--el-text-info)');
    const state = EditorState.create({ doc: '/MyAgent hi', extensions: extensions as never });
    const field = extensions[1] as never;
    const before = state.field(field);
    // A selection-only transaction (no doc change) must return the identical decoration set.
    const tr = state.update({ selection: { anchor: 0 } });
    expect(tr.state.field(field)).toBe(before);
  });
});
