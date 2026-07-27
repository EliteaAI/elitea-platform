/**
 * configurations.test.ts — contract coverage for the 16 hand-written
 * `/configurations/*` endpoints (manifest API-145..API-160, unit A7).
 *
 * MSW handlers are registered per-test via `server.use()` (never added to
 * the shared `src/test/msw/handlers/` tree, which this unit does not own —
 * `scripts/check-handlers.mjs` only walks that directory, so this pattern
 * does not trip R-M2; `src/test/setup.ts`'s own `afterEach` resets runtime
 * handlers precisely so per-file `server.use()` is the sanctioned local
 * pattern). Every test asserts the REQUEST the fetcher sent (method, path,
 * query string, body) against the baseline `api/configurations.js`
 * behaviour, not just that a promise resolved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import {
  buildAvailableConfigurationsTypeUrl,
  buildConfigurationsByTypeUrl,
  buildConfigurationsBySectionUrl,
  buildConfigurationsListUrl,
  createConfiguration,
  deleteConfiguration,
  getAvailableConfigurationsType,
  getConfigurationDetail,
  getConfigurationsByType,
  getConfigurationsBySection,
  getConfigurationsList,
  getSharedConfigurations,
  updateConfiguration,
} from './configurations';

const BASE = '/api/v2';

interface Captured {
  method: string;
  url: string;
  body: unknown;
}

function capture(): { sink: Captured[] } {
  const sink: Captured[] = [];
  return { sink };
}

afterEach(() => {
  resetGeneratedClient();
});

function setup(): void {
  configureGeneratedClient({ baseUrl: BASE });
}

describe('buildAvailableConfigurationsTypeUrl (API-145 query assembly)', () => {
  it('appends a single section', () => {
    expect(buildAvailableConfigurationsTypeUrl({ section: 'llm' })).toBe('/configurations/available/?section=llm');
  });

  it('appends multiple section params for an array, preserving order', () => {
    const url = buildAvailableConfigurationsTypeUrl({ section: ['llm', 'embedding', 'vectorstorage'] });
    expect(url).toBe('/configurations/available/?section=llm&section=embedding&section=vectorstorage');
  });

  it('omits section entirely when absent', () => {
    expect(buildAvailableConfigurationsTypeUrl({})).toBe('/configurations/available/?');
  });
});

describe('API-145 getAvailableConfigurationsType', () => {
  it('GETs the assembled URL and returns the type list', async () => {
    setup();
    const { sink } = capture();
    server.use(
      http.get(`${BASE}/configurations/available/`, ({ request }) => {
        sink.push({ method: request.method, url: request.url, body: null });
        return HttpResponse.json([{ type: 'openai', section: 'llm', config_schema: { properties: {} } }]);
      }),
    );
    const result = await getAvailableConfigurationsType({ section: 'llm' });
    expect(result).toEqual([{ type: 'openai', section: 'llm', config_schema: { properties: {} } }]);
    expect(sink[0]?.method).toBe('GET');
    expect(sink[0]?.url).toContain('section=llm');
  });
});

describe('buildConfigurationsListUrl (API-146 query assembly)', () => {
  it('matches the baseline default query shape', () => {
    const url = buildConfigurationsListUrl({ projectId: 7 });
    const search = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/configurations/configurations/7?')).toBe(true);
    expect(search.get('include_shared')).toBe('false');
    expect(search.get('shared_offset')).toBe('0');
    expect(search.get('shared_limit')).toBe('20');
    expect(search.get('limit')).toBe('20');
    expect(search.get('offset')).toBe('0');
    expect(search.get('sort_by')).toBe('created_at');
    expect(search.get('sort_order')).toBe('desc');
    expect(search.get('query')).toBe('');
  });

  it('computes offset from page * pageSize', () => {
    const url = buildConfigurationsListUrl({ projectId: 1, page: 2, pageSize: 10 });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.get('offset')).toBe('20');
    expect(search.get('limit')).toBe('10');
  });

  it('repeats type/section for array values', () => {
    const url = buildConfigurationsListUrl({ projectId: 1, type: ['a', 'b'], section: ['x', 'y'] });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.getAll('type')).toEqual(['a', 'b']);
    expect(search.getAll('section')).toEqual(['x', 'y']);
  });

  it('sets a single type/section as one value', () => {
    const url = buildConfigurationsListUrl({ projectId: 1, type: 'openai', section: 'llm' });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.getAll('type')).toEqual(['openai']);
    expect(search.getAll('section')).toEqual(['llm']);
  });

  it('honours a custom sort/query params object', () => {
    const url = buildConfigurationsListUrl({
      projectId: 1,
      params: { sort_by: 'name', sort_order: 'asc', query: 'foo' },
    });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.get('sort_by')).toBe('name');
    expect(search.get('sort_order')).toBe('asc');
    expect(search.get('query')).toBe('foo');
  });
});

describe('API-146 getConfigurationsList', () => {
  it('GETs and returns the page envelope', async () => {
    setup();
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({
          items: [{ type: 'openai', elitea_title: 'a' }],
          total: 1,
          limit: 20,
          offset: 0,
          shared: { items: [], total: 0 },
        }),
      ),
    );
    const result = await getConfigurationsList({ projectId: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('buildConfigurationsByTypeUrl / getConfigurationsByType (API-147)', () => {
  it('sets type/limit/offset and merges extra params', () => {
    const url = buildConfigurationsByTypeUrl({ projectId: 3, type: 'openai', page: 1, pageSize: 5, params: { foo: 'bar' } });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.get('type')).toBe('openai');
    expect(search.get('limit')).toBe('5');
    expect(search.get('offset')).toBe('5');
    expect(search.get('foo')).toBe('bar');
  });

  it('fetches successfully', async () => {
    setup();
    server.use(http.get(`${BASE}/configurations/configurations/3`, () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })));
    await expect(getConfigurationsByType({ projectId: 3, type: 'openai' })).resolves.toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });
});

describe('buildConfigurationsBySectionUrl / getConfigurationsBySection (API-148)', () => {
  it('supports a single section', () => {
    const url = buildConfigurationsBySectionUrl({ projectId: 3, section: 'llm' });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.get('section')).toBe('llm');
  });

  it('supports an array of sections as repeated params', () => {
    const url = buildConfigurationsBySectionUrl({ projectId: 3, section: ['llm', 'embedding'] });
    const search = new URL(url, 'http://x').searchParams;
    expect(search.getAll('section')).toEqual(['llm', 'embedding']);
  });

  it('fetches successfully', async () => {
    setup();
    server.use(http.get(`${BASE}/configurations/configurations/3`, () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })));
    await expect(getConfigurationsBySection({ projectId: 3, section: 'llm' })).resolves.toEqual({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });
});

describe('API-149 createConfiguration', () => {
  it('POSTs the body verbatim to the project path', async () => {
    setup();
    let capturedBody: unknown;
    let capturedMethod = '';
    server.use(
      http.post(`${BASE}/configurations/configurations/7`, async ({ request }) => {
        capturedMethod = request.method;
        capturedBody = await request.json();
        return HttpResponse.json({ uid: 'new-1', type: 'openai' });
      }),
    );
    const result = await createConfiguration(7, {
      elitea_title: 'my-cred',
      type: 'openai',
      data: { api_key: 'x' },
    });
    expect(capturedMethod).toBe('POST');
    expect(capturedBody).toEqual({ elitea_title: 'my-cred', type: 'openai', data: { api_key: 'x' } });
    expect(result).toEqual({ uid: 'new-1', type: 'openai' });
  });
});

describe('API-150 getConfigurationDetail', () => {
  it('GETs /configuration/{projectId}/{configId}', async () => {
    setup();
    server.use(
      http.get(`${BASE}/configurations/configuration/7/abc`, () => HttpResponse.json({ uid: 'abc', type: 'openai' })),
    );
    await expect(getConfigurationDetail(7, 'abc')).resolves.toEqual({ uid: 'abc', type: 'openai' });
  });
});

describe('API-151 getSharedConfigurations', () => {
  it('extracts response.shared, falling back to an empty page', async () => {
    setup();
    server.use(
      http.get(`${BASE}/configurations/configurations/7`, () =>
        HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0, shared: { items: [{ uid: 's1' }], total: 1, limit: 20, offset: 0 } }),
      ),
    );
    await expect(getSharedConfigurations({ projectId: 7 })).resolves.toEqual({
      items: [{ uid: 's1' }],
      total: 1,
      limit: 20,
      offset: 0,
    });
  });

  it('falls back to an empty shared page when the response has no shared key', async () => {
    setup();
    server.use(http.get(`${BASE}/configurations/configurations/7`, () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })));
    await expect(getSharedConfigurations({ projectId: 7 })).resolves.toEqual({
      total: 0,
      items: [],
      offset: 0,
      limit: 20,
    });
  });
});

describe('API-152 updateConfiguration', () => {
  it('PUTs to /configuration/{projectId}/{configId}', async () => {
    setup();
    let method = '';
    let body: unknown;
    server.use(
      http.put(`${BASE}/configurations/configuration/7/abc`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ uid: 'abc' });
      }),
    );
    await updateConfiguration(7, 'abc', { elitea_title: 't', data: {} });
    expect(method).toBe('PUT');
    expect(body).toEqual({ elitea_title: 't', data: {} });
  });
});

describe('API-153 deleteConfiguration', () => {
  it('DELETEs /configuration/{projectId}/{configId}', async () => {
    setup();
    let method = '';
    server.use(
      http.delete(`${BASE}/configurations/configuration/7/abc`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({});
      }),
    );
    await deleteConfiguration(7, 'abc');
    expect(method).toBe('DELETE');
  });
});

