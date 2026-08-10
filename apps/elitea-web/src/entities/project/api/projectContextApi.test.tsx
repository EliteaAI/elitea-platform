/**
 * `projectContextApi` had no test at all, and every fetcher in it returned the
 * `{data,status,headers}` transport envelope typed as the response BODY — the
 * same defect that rendered a once-only PAT blank in issue #132, found while
 * migrating that issue's call sites.
 *
 * The consequence was total and silent: `projectInfo?.icon_meta` and
 * `?.teammates_count` were permanently `undefined` (no uploaded project icon
 * ever rendered, the teammates count was always 0), the uploaded-icons grid was
 * permanently empty, and the AI context draft came back blank — all with 200s
 * and nothing in the console.
 *
 * These cases assert on the BODY fields, so a fetcher that hands back the
 * envelope again fails here.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  fetchProjectIcons,
  fetchProjectInfo,
  generateProjectContextDraft,
  updateProjectInfo,
  uploadProjectIcon,
} from './projectContextApi';

const BASE = '/api/v2';
const PROJECT = '42';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('projectContextApi', () => {
  it('fetchProjectInfo resolves the body, not the transport envelope', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/project_info/prompt_lib/${PROJECT}/project-info`, () =>
        HttpResponse.json({ name: 'Alpha', icon_meta: { name: 'logo', url: '/i/logo.png' }, teammates_count: 7 }),
      ),
    );

    const info = await fetchProjectInfo(PROJECT);

    expect(info.name).toBe('Alpha');
    expect(info.icon_meta).toStrictEqual({ name: 'logo', url: '/i/logo.png' });
    expect(info.teammates_count).toBe(7);
  });

  it('updateProjectInfo resolves the updated body', async () => {
    server.use(
      http.put(`${BASE}/elitea_core/project_info/prompt_lib/${PROJECT}/project-info`, async ({ request }) => {
        expect(await request.json()).toStrictEqual({ icon_meta: { name: 'logo', url: '/i/logo.png' } });
        return HttpResponse.json({ name: 'Alpha', icon_meta: { name: 'logo', url: '/i/logo.png' } });
      }),
    );

    const info = await updateProjectInfo(PROJECT, { name: 'logo', url: '/i/logo.png' });

    expect(info.icon_meta?.name).toBe('logo');
  });

  it('fetchProjectIcons returns the uploaded rows and the server total', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/project_icon/prompt_lib/${PROJECT}`, () =>
        HttpResponse.json({ rows: [{ name: 'a', url: '/i/a.png' }], total: 1 }),
      ),
    );

    const icons = await fetchProjectIcons(PROJECT);

    expect(icons.rows).toStrictEqual([{ name: 'a', url: '/i/a.png' }]);
    expect(icons.total).toBe(1);
  });

  it('uploadProjectIcon resolves the uploaded icon body', async () => {
    server.use(
      http.post(`${BASE}/elitea_core/project_icon/prompt_lib/${PROJECT}`, () =>
        HttpResponse.json({ name: 'a', url: '/i/a.png' }),
      ),
    );

    const uploaded = await uploadProjectIcon(PROJECT, { file: new File(['x'], 'a.png', { type: 'image/png' }) });

    expect(uploaded).toStrictEqual({ name: 'a', url: '/i/a.png' });
  });

  it('generateProjectContextDraft resolves the generated text', async () => {
    server.use(
      http.post(`${BASE}/elitea_core/generate_project_context_draft/prompt_lib/${PROJECT}`, () =>
        HttpResponse.json({ project_background: 'A drafted background.' }),
      ),
    );

    const draft = await generateProjectContextDraft(PROJECT, { user_description: 'a team' });

    expect(draft.project_background).toBe('A drafted background.');
  });
});
