import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getListApplicationSkillsMockHandler } from '@/shared/api/generated/skills/skills.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useInstructionsSkillMention } from './useInstructionsSkillMention.hooks';
import type { FileReaderInputHandle } from './useInstructionsMention.hooks';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeRef(initial = ''): { current: FileReaderInputHandle | null } {
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

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useInstructionsSkillMention', () => {
  it('maps generated Skill.id -> skill_id and sorts by name (real field-name deviation from the baseline)', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 'skill-2',
            project_id: 'p1',
            name: 'Zeta Skill',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 'skill-1',
            project_id: 'p1',
            name: 'Alpha Skill',
            description: 'Does alpha things',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );

    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(2));
    expect(result.current.mentionableItems).toStrictEqual([
      { name: 'Alpha Skill', description: 'Does alpha things', skill_id: 'skill-1', isToolkit: false },
      { name: 'Zeta Skill', description: undefined, skill_id: 'skill-2', isToolkit: false },
    ]);
  });

  it('does not query while projectId is undefined', () => {
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: undefined,
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    expect(result.current.mentionableItems).toStrictEqual([]);
  });

  it('onSelectItem writes "~name " into the ref and commits the mention', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const ref = makeRef('');
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: ref,
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));

    act(() =>
      result.current.onKeyDown({ key: '~', target: { selectionStart: 0 }, preventDefault: vi.fn() }),
    );
    const item = result.current.mentionableItems[0];
    expect(item).toBeDefined();
    act(() => {
      if (item) result.current.onSelectItem(item);
    });
    expect(ref.current?.getInputContent?.()).toBe('~pdf-extractor ');
    expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]);
  });

  it('seeds committedMentions from existing "~name" tokens in the instructions text', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: 'Please use ~pdf-extractor now.',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]),
    );
  });

  it('accepts versionId as a numeric string (Number(versionId) coercion branch)', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: '7',
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));
  });

  it('does not query while versionId is undefined (appVersionId ?? NaN fallback)', () => {
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: undefined,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    expect(result.current.mentionableItems).toStrictEqual([]);
  });

  it('dedupes when the same "~name" token appears more than once in the instructions text', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: '~pdf-extractor please, ~pdf-extractor again',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]),
    );
  });

  it('seeds a "~name" mention that starts at position 0 (prevChar sentinel branch)', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: '~pdf-extractor please',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]),
    );
  });

  it('filters mentionableItems by itemQuery once the user has typed after "~"', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 's2',
            project_id: 'p1',
            name: 'csv-parser',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    // No getCursorPosition on this ref, so onInstructionsInputChange falls back to
    // value.length as the cursor position (matches the whole typed value).
    const ref = { current: { replaceRange: vi.fn() } as FileReaderInputHandle };
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: ref,
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(2));

    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    act(() => result.current.onInstructionsInputChange('~csv'));
    expect(result.current.filteredItems).toStrictEqual([
      { name: 'csv-parser', description: undefined, skill_id: 's2', isToolkit: false },
    ]);
  });

  it('onInstructionsInputChange with an empty value resets the slash state back to idle', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));

    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    expect(result.current.phase).toBe('items');
    act(() => result.current.onInstructionsInputChange(''));
    expect(result.current.phase).toBe('idle');
  });

  it('onSelectItem is a no-op replaceFragment when fileReaderRef.current is null, but still commits the mention', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const ref: { current: FileReaderInputHandle | null } = { current: null };
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: ref,
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));

    const item = result.current.mentionableItems[0];
    expect(item).toBeDefined();
    act(() => {
      if (item) result.current.onSelectItem(item);
    });
    expect(result.current.committedMentions).toStrictEqual([{ name: 'pdf-extractor', tool_name: null }]);
  });

  it('onSelectItem falls back to anchor 0 and content.length when the ref exposes only replaceRange', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const replaceRange = vi.fn();
    const ref = { current: { replaceRange } as FileReaderInputHandle };
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: ref,
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));

    const item = result.current.mentionableItems[0];
    expect(item).toBeDefined();
    // No prior "~" keydown, so mentionAnchorRef.current is null -> anchor falls back to 0;
    // no getCursorPosition/getInputContent on this ref -> end falls back to content.length (0,
    // since inputContentRef starts as '').
    act(() => {
      if (item) result.current.onSelectItem(item);
    });
    expect(replaceRange).toHaveBeenCalledWith(0, 0, '~pdf-extractor ');
  });

  it('navigates the Items phase with ArrowDown/ArrowUp/Enter via onKeyDown directly', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'alpha-skill',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
          {
            id: 's2',
            project_id: 'p1',
            name: 'beta-skill',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const ref = makeRef('');
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: ref,
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(2));

    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    expect(result.current.highlightedIndex).toBe(0);

    const arrowUp = vi.fn();
    act(() => result.current.onKeyDown({ key: 'ArrowUp', preventDefault: arrowUp }));
    expect(arrowUp).toHaveBeenCalledOnce();
    expect(result.current.highlightedIndex).toBe(1);

    const arrowDown = vi.fn();
    act(() => result.current.onKeyDown({ key: 'ArrowDown', preventDefault: arrowDown }));
    expect(arrowDown).toHaveBeenCalledOnce();
    expect(result.current.highlightedIndex).toBe(0);

    const enter = vi.fn();
    act(() => result.current.onKeyDown({ key: 'Enter', preventDefault: enter }));
    expect(enter).toHaveBeenCalledOnce();
    expect(result.current.committedMentions).toStrictEqual([{ name: 'alpha-skill', tool_name: null }]);
    expect(result.current.phase).toBe('idle');
  });

  it('falls through to the tilda machine\'s own onKeyDown when not in an active Items navigation (e.g. Escape)', async () => {
    server.use(
      getListApplicationSkillsMockHandler({
        items: [
          {
            id: 's1',
            project_id: 'p1',
            name: 'pdf-extractor',
            type: 'skill',
            is_default: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    );
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: 'p1',
          versionId: 7,
          instructions: '',
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.mentionableItems).toHaveLength(1));

    act(() => result.current.onKeyDown({ key: '~', target: { selectionStart: 0 }, preventDefault: vi.fn() }));
    expect(result.current.phase).toBe('items');
    act(() => result.current.onKeyDown({ key: 'Escape', preventDefault: vi.fn() }));
    expect(result.current.phase).toBe('idle');
  });

  it('computes empty highlightRanges when instructions is undefined (fallback to "")', () => {
    const { result } = renderHook(
      () =>
        useInstructionsSkillMention({
          fileReaderRef: makeRef(),
          projectId: undefined,
          versionId: 7,
          instructions: undefined,
          highlightColor: 'var(--el-text-info)',
        }),
      { wrapper: createWrapper() },
    );
    expect(result.current.highlightRanges).toStrictEqual([]);
  });
});
