import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { getListTagsMockHandler } from '@/shared/api/generated/tags/tags.msw';
import { server } from '@/test/setup';

import { Skills, filterSkillsByTags } from './Skills';
import { renderSkillsRoute } from './__tests__/testRouter';

const BASE = '/api/v2';

function makeSkill(id: string, name: string, tags: readonly string[]) {
  return {
    id,
    project_id: 'project-1',
    name,
    description: 'A skill',
    type: 'skill',
    is_default: false,
    tags: [...tags],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(
    http.get(`${BASE}/elitea_core/skills/prompt_lib/:projectId`, () =>
      HttpResponse.json({
        items: [makeSkill('skill-1', 'Reviewer', ['alpha']), makeSkill('skill-2', 'Summariser', ['beta'])],
        total: 2,
        page: 1,
        page_size: 20,
        total_pages: 1,
      }),
    ),
    getListTagsMockHandler({
      rows: [
        { id: 1, name: 'alpha', data: {} },
        { id: 2, name: 'beta', data: {} },
      ],
      total: 2,
    }),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('filterSkillsByTags', () => {
  const items = [
    { id: 'a', tags: ['alpha', 'beta'] },
    { id: 'b', tags: ['beta'] },
    { id: 'c', tags: undefined },
  ];

  it('passes everything through when nothing is selected', () => {
    expect(filterSkillsByTags(items, []).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps only rows carrying EVERY selected tag (the merge-and-sort.ts predicate)', () => {
    expect(filterSkillsByTags(items, ['beta']).map((item) => item.id)).toEqual(['a', 'b']);
    expect(filterSkillsByTags(items, ['alpha', 'beta']).map((item) => item.id)).toEqual(['a']);
  });

  it('treats an absent tag list as no tags rather than throwing', () => {
    expect(filterSkillsByTags(items, ['alpha']).map((item) => item.id)).toEqual(['a']);
  });
});

describe('Skills right-hand rail', () => {
  it('renders the rail with the project tags and hoists the search bar into it', async () => {
    renderSkillsRoute(<Skills />);

    const rail = await screen.findByTestId('entity-rail');
    expect(rail).toContainElement(await screen.findByPlaceholderText('Search skills'));
    expect(await screen.findByTestId('tags-panel-chip-alpha')).toBeInTheDocument();
    // Exactly one search box on the page — the page-body copy is replaced by
    // the rail's, not duplicated alongside it.
    expect(screen.getAllByPlaceholderText('Search skills')).toHaveLength(1);
  });

  it('filters the skill list down to the selected tag', async () => {
    const user = userEvent.setup();
    const { router } = renderSkillsRoute(<Skills />);

    expect(await screen.findByText('Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Summariser')).toBeInTheDocument();

    await user.click(await screen.findByTestId('tags-panel-chip-alpha'));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ 'tags[]': ['alpha'] }));
    await waitFor(() => expect(screen.queryByText('Summariser')).toBeNull());
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });
});
