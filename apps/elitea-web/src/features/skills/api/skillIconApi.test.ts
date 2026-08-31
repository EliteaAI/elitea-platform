/**
 * Contract tests for the skill icon endpoints — parity manifest API-070…073.
 *
 * The assertions that matter are the URL each call targets and, for the
 * listing, that the ROWS reach the caller. `eliteaFetch` resolves a
 * `{data,status,headers}` envelope, so a listing typed one level too shallow
 * returns `undefined` fields on a 200 and the gallery renders empty with
 * nothing in the console (#132). A test that only asserted "resolves" would
 * pass against exactly that, so each case reads a field back.
 */
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';

import { bindSkillIcon, deleteSkillIcon, fetchSkillIcons, uploadSkillIcon } from './skillIconApi';

const BASE = '/api/v2';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

describe('skillIconApi', () => {
  it('getSkillIcons reads the rows out of the {rows,total} body', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('limit')).toBe('200');
        expect(url.searchParams.get('skip')).toBe('0');
        return HttpResponse.json({
          rows: [{ name: 'skill_a.png', url: '/icons/7/skill_a.png' }],
          total: 1,
        });
      }),
    );

    const page = await fetchSkillIcons('7');
    expect(page.total).toBe(1);
    expect(page.rows).toEqual([{ name: 'skill_a.png', url: '/icons/7/skill_a.png' }]);
  });

  it('uploadSkillIcon posts multipart to the versionless path when no version is given', async () => {
    let seenPath = '';
    let seenType = '';
    let seenBody = '';
    server.use(
      http.post(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7`, async ({ request }) => {
        seenPath = new URL(request.url).pathname;
        seenType = request.headers.get('content-type') ?? '';
        // The RAW body, not request.formData(): undici's multipart parser is
        // not available in this environment, and a parse that throws inside a
        // handler surfaces as a 500 rather than as a failed assertion.
        seenBody = await request.text();
        return HttpResponse.json({ name: 'skill_a.png', url: '/icons/7/skill_a.png' });
      }),
    );

    const meta = await uploadSkillIcon('7', {
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      width: 64,
      height: 32,
    });

    expect(seenPath).toBe(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7`);
    expect(seenType).toMatch(/^multipart\/form-data/);
    for (const field of ['name="file"', 'name="width"', 'name="height"']) {
      expect(seenBody).toContain(field);
    }
    expect(meta.url).toBe('/icons/7/skill_a.png');
  });

  it('uploadSkillIcon appends the version id when one is given', async () => {
    let seenPath = '';
    server.use(
      http.post(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/42`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ name: 'skill_a.png', url: '/icons/7/skill_a.png' });
      }),
    );

    await uploadSkillIcon('7', {
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      versionId: '42',
    });
    expect(seenPath).toBe(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/42`);
  });

  it('bindSkillIcon PUTs the icon meta at the version path', async () => {
    let body: unknown;
    server.use(
      http.put(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/42`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ updated: true });
      }),
    );

    await bindSkillIcon('7', {
      versionId: '42',
      iconMeta: { name: 'skill_a.png', url: '/icons/7/skill_a.png' },
    });
    expect(body).toEqual({ name: 'skill_a.png', url: '/icons/7/skill_a.png' });
  });

  it('bindSkillIcon sends an empty name/url pair to reset to the default icon', async () => {
    let body: unknown;
    server.use(
      http.put(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/42`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ updated: true });
      }),
    );

    await bindSkillIcon('7', { versionId: '42', iconMeta: null });
    // NOT `{}` and NOT an omitted pair: the server requires both keys to be
    // present strings, so a reset is the empty pair.
    expect(body).toEqual({ name: '', url: '' });
  });

  it('deleteSkillIcon encodes the icon name into the path', async () => {
    let seenPath = '';
    server.use(
      http.delete(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/:name`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({ ok: true });
      }),
    );

    await deleteSkillIcon('7', 'skill a.png');
    expect(seenPath).toBe(`${BASE}/elitea_core/upload_skill_icon/prompt_lib/7/skill%20a.png`);
  });
});
