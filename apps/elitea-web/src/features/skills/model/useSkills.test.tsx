import { act, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  createTestQueryClient,
  renderHookWithProviders,
} from '../__tests__/testUtils';
import { skillQueryKeys, useSkill, useSkillMutations, useSkills } from './useSkills';

const BASE = '/api/v2';
const skill = {
  id: 'skill-1',
  project_id: 'project-1',
  name: 'Review',
  description: 'Review code',
  type: 'skill',
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => configureGeneratedClient({ baseUrl: BASE }));
afterEach(() => resetGeneratedClient());

describe('skills query hooks', () => {
  it('builds stable scoped query keys', () => {
    expect(skillQueryKeys.all('p')).toEqual(['skills', 'p']);
    expect(skillQueryKeys.list('p', 'q')).toEqual(['skills', 'p', 'list', 'q']);
    expect(skillQueryKeys.detail('p', 's')).toEqual(['skills', 'p', 'detail', 's', 'default']);
    expect(skillQueryKeys.detail('p', 's', 'v')).toEqual(['skills', 'p', 'detail', 's', 'v']);
  });

  it('loads list and detail only after identifiers are available', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/skills/prompt_lib/:projectId`, () =>
        HttpResponse.json({ items: [skill], total: 1, page: 1, page_size: 20, total_pages: 1 }),
      ),
      http.get(`${BASE}/elitea_core/skill/prompt_lib/:projectId/:skillId`, () =>
        HttpResponse.json(skill),
      ),
    );
    const list = renderHookWithProviders(() => useSkills('project-1', 'review'));
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(1));
    const detail = renderHookWithProviders(() => useSkill('project-1', 'skill-1'));
    await waitFor(() => expect(detail.result.current.data?.name).toBe('Review'));

    const disabled = renderHookWithProviders(() => useSkills(undefined, ''));
    expect(disabled.result.current.fetchStatus).toBe('idle');
  });

  it('exposes working create, update, version, default, delete, draft, and import mutations', async () => {
    server.use(
      http.post(`${BASE}/elitea_core/skills/prompt_lib/:projectId`, () => HttpResponse.json(skill)),
      http.put(`${BASE}/elitea_core/skill/prompt_lib/:projectId/:skillId`, () => HttpResponse.json(skill)),
      http.post(`${BASE}/elitea_core/skill/prompt_lib/:projectId/:skillId`, () => HttpResponse.json(skill)),
      http.patch(`${BASE}/elitea_core/skill_default_version/prompt_lib/:projectId/:skillId`, () => HttpResponse.json(skill)),
      http.delete(`${BASE}/elitea_core/skill/prompt_lib/:projectId/:skillId`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${BASE}/elitea_core/generate_skill_draft/prompt_lib/:projectId`, () =>
        HttpResponse.json({ name: 'Draft', description: 'D', instructions: 'I', tags: [] }),
      ),
      http.post(`${BASE}/elitea_core/skill_import/prompt_lib/:projectId`, () => HttpResponse.json(skill)),
    );
    const queryClient = createTestQueryClient();
    const hook = renderHookWithProviders(() => useSkillMutations('project-1'), queryClient);
    const input = { name: 'Review', description: 'Code', instructions: 'Run', tags: [] };

    await act(() => hook.result.current.create.mutateAsync(input));
    await act(() => hook.result.current.update.mutateAsync({ skillId: 'skill-1', input }));
    await act(() =>
      hook.result.current.createVersion.mutateAsync({
        skillId: 'skill-1',
        input: { name: 'v2', instructions: 'Run', tags: [] },
      }),
    );
    await act(() =>
      hook.result.current.setDefault.mutateAsync({ skillId: 'skill-1', versionId: 'v2' }),
    );
    await act(() => hook.result.current.remove.mutateAsync({ skillId: 'skill-1' }));
    await act(() => hook.result.current.generate.mutateAsync('Make a skill'));
    await act(() =>
      hook.result.current.importFile.mutateAsync(
        new File(['---'], 'skill.md', { type: 'text/markdown' }),
      ),
    );

    expect(hook.result.current.generate.data?.name).toBe('Draft');
    expect(queryClient.getQueryState(skillQueryKeys.all('project-1'))).toBeUndefined();
  });
});
