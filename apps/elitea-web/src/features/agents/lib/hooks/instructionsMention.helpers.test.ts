import { describe, expect, it, vi } from 'vitest';

import {
  computeDismissToolReplacement,
  computeToolReplacement,
  handleItemsPhaseKey,
  handleToolsPhaseKey,
  resolveAvailableTools,
  seedMentionsFromText,
  type FilteredMentionableItem,
  type SelectedItemLike,
} from './instructionsMention.helpers';

function item(overrides: Partial<FilteredMentionableItem> & { readonly name: string }): FilteredMentionableItem {
  return {
    type: undefined,
    agent_type: undefined,
    settings: undefined,
    isToolkit: false,
    description: '',
    ...overrides,
  };
}

describe('seedMentionsFromText', () => {
  it('returns [] when text is undefined', () => {
    expect(seedMentionsFromText(undefined, [item({ name: 'Github' })])).toStrictEqual([]);
  });

  it('returns [] when text is empty', () => {
    expect(seedMentionsFromText('', [item({ name: 'Github' })])).toStrictEqual([]);
  });

  it('returns [] when there are no mentionable items', () => {
    expect(seedMentionsFromText('/Github', [])).toStrictEqual([]);
  });

  it('commits a toolkit mention followed by "/toolName"', () => {
    const result = seedMentionsFromText('Use /Github/create_issue please', [
      item({ name: 'Github', isToolkit: true }),
    ]);
    expect(result).toStrictEqual([{ name: 'Github', tool_name: 'create_issue' }]);
  });

  it('commits a toolkit mention followed by "#toolName"', () => {
    const result = seedMentionsFromText('Use /Github#create_issue please', [
      item({ name: 'Github', isToolkit: true }),
    ]);
    expect(result).toStrictEqual([{ name: 'Github', tool_name: 'create_issue' }]);
  });

  it('commits a bare toolkit mention with no tool suffix (end of string)', () => {
    const result = seedMentionsFromText('Please use /Github', [item({ name: 'Github', isToolkit: true })]);
    expect(result).toStrictEqual([{ name: 'Github', tool_name: null }]);
  });

  it('commits a bare toolkit mention followed by whitespace', () => {
    const result = seedMentionsFromText('Please use /Github now', [item({ name: 'Github', isToolkit: true })]);
    expect(result).toStrictEqual([{ name: 'Github', tool_name: null }]);
  });

  it('commits a non-toolkit mention at end of string', () => {
    const result = seedMentionsFromText('Use /SubAgent', [item({ name: 'SubAgent', isToolkit: false })]);
    expect(result).toStrictEqual([{ name: 'SubAgent', tool_name: null }]);
  });

  it('does not commit a non-toolkit item when the token is only a partial-name prefix match', () => {
    const result = seedMentionsFromText('Use /SubAgentX', [item({ name: 'SubAgent', isToolkit: false })]);
    expect(result).toStrictEqual([]);
  });

  it('does not commit a mention when not preceded by a word boundary', () => {
    const result = seedMentionsFromText('xUse/Github', [item({ name: 'Github', isToolkit: true })]);
    expect(result).toStrictEqual([]);
  });

  it('commits a mention at the very start of the text (prevChar boundary sentinel)', () => {
    const result = seedMentionsFromText('/SubAgent hi', [item({ name: 'SubAgent', isToolkit: false })]);
    expect(result).toStrictEqual([{ name: 'SubAgent', tool_name: null }]);
  });

  it('dedupes repeated occurrences of the same token', () => {
    const result = seedMentionsFromText('/SubAgent and /SubAgent again', [
      item({ name: 'SubAgent', isToolkit: false }),
    ]);
    expect(result).toStrictEqual([{ name: 'SubAgent', tool_name: null }]);
  });

  it('processes items longest-name-first so a longer name is not shadowed by a shorter prefix match', () => {
    const result = seedMentionsFromText('Use /GithubMcp for it', [
      item({ name: 'Github', isToolkit: true }),
      item({ name: 'GithubMcp', isToolkit: false }),
    ]);
    expect(result).toStrictEqual([{ name: 'GithubMcp', tool_name: null }]);
  });
});

describe('computeDismissToolReplacement', () => {
  it('builds the "/Name " replacement and the nameEnd offset', () => {
    const result = computeDismissToolReplacement(5, 'Github');
    expect(result).toStrictEqual({ nameEnd: 5 + '/Github'.length, replacement: '/Github ' });
  });
});

describe('computeToolReplacement', () => {
  it('builds "/Name/tool " and stops at the next whitespace after the name', () => {
    const content = 'Use /Github/create_iss extra text';
    const result = computeToolReplacement(content, 4, 'Github', 'create_issue');
    const afterNameStart = 4 + '/Github'.length;
    expect(result).toStrictEqual({
      end: afterNameStart + '/create_iss'.length,
      replacement: '/Github/create_issue ',
    });
  });

  it('extends to the end of content when there is no trailing whitespace', () => {
    const content = 'Use /Github/create_iss';
    const result = computeToolReplacement(content, 4, 'Github', 'create_issue');
    expect(result).toStrictEqual({ end: content.length, replacement: '/Github/create_issue ' });
  });
});

describe('resolveAvailableTools', () => {
  it('returns [] when resolvedSelectedItem is null', () => {
    expect(resolveAvailableTools(null)).toStrictEqual([]);
  });

  it('returns [] when the item has no settings', () => {
    const selected: SelectedItemLike = { name: 'Github' };
    expect(resolveAvailableTools(selected)).toStrictEqual([]);
  });

  it('maps available_mcp_tools for type "mcp", preferring value over label', () => {
    const selected: SelectedItemLike = {
      name: 'GithubMcp',
      type: 'mcp',
      settings: { available_mcp_tools: [{ value: 'create_issue', label: 'Create Issue' }, { label: 'List only' }] },
    };
    expect(resolveAvailableTools(selected)).toStrictEqual([
      { name: 'create_issue', description: '' },
      { name: 'List only', description: '' },
    ]);
  });

  it('maps available_mcp_tools for a type starting with "mcp_"', () => {
    const selected: SelectedItemLike = {
      name: 'GithubMcp',
      type: 'mcp_github',
      settings: { available_mcp_tools: [{ value: 'x' }] },
    };
    expect(resolveAvailableTools(selected)).toStrictEqual([{ name: 'x', description: '' }]);
  });

  it('falls back to an empty name when a tool has neither value nor label', () => {
    const selected: SelectedItemLike = {
      name: 'GithubMcp',
      type: 'mcp',
      settings: { available_mcp_tools: [{}] },
    };
    expect(resolveAvailableTools(selected)).toStrictEqual([{ name: '', description: '' }]);
  });

  it('uses selected_tools for a non-mcp toolkit', () => {
    const selected: SelectedItemLike = {
      name: 'Github',
      type: 'github',
      settings: { selected_tools: ['create_issue', 'close_issue'] },
    };
    expect(resolveAvailableTools(selected)).toStrictEqual([
      { name: 'create_issue', description: '' },
      { name: 'close_issue', description: '' },
    ]);
  });

  it('returns [] when settings exist but neither list is present', () => {
    const selected: SelectedItemLike = { name: 'Github', type: 'github', settings: {} };
    expect(resolveAvailableTools(selected)).toStrictEqual([]);
  });
});

function keyEvent(key: string): { key: string; preventDefault: ReturnType<typeof vi.fn<() => void>> } {
  return { key, preventDefault: vi.fn<() => void>() };
}

describe('handleItemsPhaseKey', () => {
  const items: readonly FilteredMentionableItem[] = [
    item({ name: 'Alpha' }),
    item({ name: 'Beta' }),
    item({ name: 'Gamma' }),
  ];

  it('returns false immediately when filteredItems is empty', () => {
    const setHighlightedIndex = vi.fn();
    const onSelectItem = vi.fn();
    const handled = handleItemsPhaseKey(keyEvent('ArrowDown'), {
      filteredItems: [],
      highlightedIndex: 0,
      setHighlightedIndex,
      onSelectItem,
    });
    expect(handled).toBe(false);
    expect(setHighlightedIndex).not.toHaveBeenCalled();
  });

  it('ArrowDown advances and wraps the highlighted index', () => {
    const setHighlightedIndex = vi.fn();
    const event = keyEvent('ArrowDown');
    const handled = handleItemsPhaseKey(event, {
      filteredItems: items,
      highlightedIndex: 2,
      setHighlightedIndex,
      onSelectItem: vi.fn(),
    });
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    const updater = setHighlightedIndex.mock.calls[0]?.[0] as (prev: number) => number;
    expect(updater(2)).toBe(0);
  });

  it('ArrowUp wraps to the last index when at or before 0', () => {
    const setHighlightedIndex = vi.fn();
    const handled = handleItemsPhaseKey(keyEvent('ArrowUp'), {
      filteredItems: items,
      highlightedIndex: 0,
      setHighlightedIndex,
      onSelectItem: vi.fn(),
    });
    expect(handled).toBe(true);
    const updater = setHighlightedIndex.mock.calls[0]?.[0] as (prev: number) => number;
    expect(updater(0)).toBe(items.length - 1);
    expect(updater(2)).toBe(1);
  });

  it('Enter with a valid highlighted index selects the item, passing its own isToolkit', () => {
    const onSelectItem = vi.fn();
    const handled = handleItemsPhaseKey(keyEvent('Enter'), {
      filteredItems: [item({ name: 'Alpha', isToolkit: true })],
      highlightedIndex: 0,
      setHighlightedIndex: vi.fn(),
      onSelectItem,
    });
    expect(handled).toBe(true);
    expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alpha' }), true);
  });

  it('Enter with highlightedIndex -1 is not handled', () => {
    const onSelectItem = vi.fn();
    const handled = handleItemsPhaseKey(keyEvent('Enter'), {
      filteredItems: items,
      highlightedIndex: -1,
      setHighlightedIndex: vi.fn(),
      onSelectItem,
    });
    expect(handled).toBe(false);
    expect(onSelectItem).not.toHaveBeenCalled();
  });

  it('an unrecognized key is not handled', () => {
    const handled = handleItemsPhaseKey(keyEvent('Escape'), {
      filteredItems: items,
      highlightedIndex: 0,
      setHighlightedIndex: vi.fn(),
      onSelectItem: vi.fn(),
    });
    expect(handled).toBe(false);
  });
});

describe('handleToolsPhaseKey', () => {
  const tools: readonly { readonly name: string; readonly description: string }[] = [
    { name: 'create_issue', description: '' },
    { name: 'close_issue', description: '' },
  ];

  it('returns false immediately when filteredTools is empty', () => {
    const handled = handleToolsPhaseKey(keyEvent('ArrowDown'), {
      filteredTools: [],
      highlightedIndex: 0,
      setHighlightedIndex: vi.fn(),
      onSelectTool: vi.fn(),
    });
    expect(handled).toBe(false);
  });

  it('ArrowDown wraps the highlighted index', () => {
    const setHighlightedIndex = vi.fn();
    const handled = handleToolsPhaseKey(keyEvent('ArrowDown'), {
      filteredTools: tools,
      highlightedIndex: 1,
      setHighlightedIndex,
      onSelectTool: vi.fn(),
    });
    expect(handled).toBe(true);
    const updater = setHighlightedIndex.mock.calls[0]?.[0] as (prev: number) => number;
    expect(updater(1)).toBe(0);
  });

  it('ArrowUp wraps to the last index when at or before 0', () => {
    const setHighlightedIndex = vi.fn();
    const handled = handleToolsPhaseKey(keyEvent('ArrowUp'), {
      filteredTools: tools,
      highlightedIndex: 0,
      setHighlightedIndex,
      onSelectTool: vi.fn(),
    });
    expect(handled).toBe(true);
    const updater = setHighlightedIndex.mock.calls[0]?.[0] as (prev: number) => number;
    expect(updater(0)).toBe(tools.length - 1);
  });

  it('Enter with a valid highlighted index selects the tool by name', () => {
    const onSelectTool = vi.fn();
    const handled = handleToolsPhaseKey(keyEvent('Enter'), {
      filteredTools: tools,
      highlightedIndex: 1,
      setHighlightedIndex: vi.fn(),
      onSelectTool,
    });
    expect(handled).toBe(true);
    expect(onSelectTool).toHaveBeenCalledWith('close_issue');
  });

  it('Enter with highlightedIndex -1 is not handled', () => {
    const onSelectTool = vi.fn();
    const handled = handleToolsPhaseKey(keyEvent('Enter'), {
      filteredTools: tools,
      highlightedIndex: -1,
      setHighlightedIndex: vi.fn(),
      onSelectTool,
    });
    expect(handled).toBe(false);
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it('an unrecognized key is not handled', () => {
    const handled = handleToolsPhaseKey(keyEvent('Escape'), {
      filteredTools: tools,
      highlightedIndex: 0,
      setHighlightedIndex: vi.fn(),
      onSelectTool: vi.fn(),
    });
    expect(handled).toBe(false);
  });
});
