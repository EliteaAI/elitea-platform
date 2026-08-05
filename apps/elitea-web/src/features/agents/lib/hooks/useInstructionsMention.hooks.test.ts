import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApplicationsStore } from '../../model/applicationsStore';
import { useInstructionsMention } from './useInstructionsMention.hooks';
import type { FileReaderInputHandle, MentionableTool } from './useInstructionsMention.hooks';

afterEach(() => {
  useApplicationsStore.setState({ versionValidationInfo: {} });
});

function makeRef(initial = ''): RefObject<FileReaderInputHandle | null> {
  let content = initial;
  let cursor = initial.length;
  return {
    current: {
      getInputContent: () => content,
      getCursorPosition: () => cursor,
      replaceRange: (start: number, end: number, replacement: string) => {
        content = content.slice(0, start) + replacement + content.slice(end);
        cursor = start + replacement.length;
      },
    },
  };
}

const TOOLS: readonly MentionableTool[] = [
  { id: 1, name: 'Github', type: 'github', settings: { selected_tools: ['create_issue'] } },
  { id: 2, name: 'SubAgent', type: 'application', agent_type: 'chat' },
  { id: 3, name: 'MyPipeline', type: 'application', agent_type: 'pipeline' },
];

describe('useInstructionsMention', () => {
  it('resolves mentionableItems sorted by name, with description/isToolkit set correctly', () => {
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    expect(result.current.mentionableItems.map((i) => i.name)).toStrictEqual(['Github', 'MyPipeline', 'SubAgent']);
    const github = result.current.mentionableItems.find((i) => i.name === 'Github');
    expect(github?.isToolkit).toBe(true);
    expect(github?.description).toBe('Toolkit');
    const pipeline = result.current.mentionableItems.find((i) => i.name === 'MyPipeline');
    expect(pipeline?.isToolkit).toBe(false);
    expect(pipeline?.description).toBe('Pipeline');
  });

  it('filters out a tool whose id has a recorded validation error in the shared applications store', () => {
    useApplicationsStore.setState({
      versionValidationInfo: { 'proj-1_app-1_v1': [{ loc: ['tools', 1] }] },
    });
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    expect(result.current.mentionableItems.map((i) => i.name)).not.toContain('Github');
  });

  it('excludes a not-logged-in pre-built MCP tool when isToolLoggedIn says so', () => {
    const mcpTool: MentionableTool = { id: 9, name: 'GithubMcp', type: 'mcp_github' };
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: [mcpTool],
        instructions: '',
        highlightColor: 'var(--el-text-info)',
        isToolLoggedIn: () => false,
      }),
    );
    expect(result.current.mentionableItems).toStrictEqual([]);
  });

  it('includes a pre-built MCP tool when isToolLoggedIn is omitted (default: no additional filtering)', () => {
    const mcpTool: MentionableTool = { id: 9, name: 'GithubMcp', type: 'mcp_github' };
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: [mcpTool],
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    expect(result.current.mentionableItems.map((i) => i.name)).toStrictEqual(['GithubMcp']);
  });

  it('seeds committedMentions from pre-existing instructions text on mount', () => {
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: 'Use /Github/create_issue and /SubAgent for help.',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    expect(result.current.committedMentions).toStrictEqual(
      expect.arrayContaining([
        { name: 'Github', tool_name: 'create_issue' },
        { name: 'SubAgent', tool_name: null },
      ]),
    );
  });

  it('onInstructionsInputChange with an empty value resets the slash state', () => {
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    act(() => result.current.onKeyDown({ key: '/', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    expect(result.current.phase).toBe('items');
    act(() => result.current.onInstructionsInputChange(''));
    expect(result.current.phase).toBe('idle');
  });

  it('onSelectItem for a non-toolkit item writes "/Name " into the file reader ref and commits directly', () => {
    const ref = makeRef('');
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: ref,
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    const subAgent = result.current.mentionableItems.find((i) => i.name === 'SubAgent');
    expect(subAgent).toBeDefined();
    act(() => {
      if (subAgent) result.current.onSelectItem(subAgent, false);
    });
    expect(ref.current?.getInputContent?.()).toBe('/SubAgent ');
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual([{ name: 'SubAgent', tool_name: null }]);
  });

  it('onSelectItem for a toolkit advances to the tools phase and exposes its filteredTools', () => {
    const ref = makeRef('');
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: ref,
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    const github = result.current.mentionableItems.find((i) => i.name === 'Github');
    expect(github).toBeDefined();
    act(() => {
      if (github) result.current.onSelectItem(github, true);
    });
    expect(result.current.phase).toBe('tools');
    expect(result.current.filteredTools).toStrictEqual([{ name: 'create_issue', description: '' }]);
  });

  it('onSelectTool commits "/Toolkit/tool " and returns to idle', () => {
    const ref = makeRef('');
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: ref,
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    const github = result.current.mentionableItems.find((i) => i.name === 'Github');
    act(() => {
      if (github) result.current.onSelectItem(github, true);
    });
    act(() => result.current.onSelectTool('create_issue'));
    expect(ref.current?.getInputContent?.()).toBe('/Github/create_issue ');
    expect(result.current.phase).toBe('idle');
    expect(result.current.committedMentions).toStrictEqual(
      expect.arrayContaining([{ name: 'Github', tool_name: 'create_issue' }]),
    );
  });

  it('ArrowDown/Enter in the items phase navigates and selects via keyboard', () => {
    const ref = makeRef('');
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: ref,
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    act(() => result.current.onKeyDown({ key: '/', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    const preventDefault = vi.fn();
    act(() => result.current.onKeyDown({ key: 'ArrowDown', preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.highlightedIndex).toBe(1);
    act(() => result.current.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }));
    // Item at index 1 ("MyPipeline") gets selected.
    expect(result.current.committedMentions).toStrictEqual(
      expect.arrayContaining([{ name: 'MyPipeline', tool_name: null }]),
    );
  });

  it('builds non-empty highlightRanges/codeMirrorExtensions once a mention is committed in the instructions text', () => {
    const { result } = renderHook(() =>
      useInstructionsMention({
        fileReaderRef: makeRef(),
        applicationId: 'app-1',
        projectId: 'proj-1',
        versionId: 'v1',
        tools: TOOLS,
        instructions: '/SubAgent hello',
        highlightColor: 'var(--el-text-info)',
      }),
    );
    expect(result.current.highlightRanges).toStrictEqual([{ start: 0, end: 9 }]);
    expect(result.current.codeMirrorExtensions.length).toBeGreaterThan(0);
  });
});
