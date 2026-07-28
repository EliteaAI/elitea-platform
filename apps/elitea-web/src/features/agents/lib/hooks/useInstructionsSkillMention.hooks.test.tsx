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
});
