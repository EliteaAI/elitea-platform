import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { buildConfigurationsListUrl, createConfiguration, getAvailableConfigurationsType, getConfigurationsList, testConfigurationConnection } from './configurations';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('createConfiguration', () => {
  it('POSTs to /configurations/configurations/{projectId} and unwraps the envelope', async () => {
    server.use(
      http.post('*/api/v2/configurations/configurations/p1', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ elitea_title: 'My Config', type: 'sharepoint', data: { url: 'x' } });
        return HttpResponse.json({ id: '1', type: 'sharepoint', elitea_title: 'My Config' });
      }),
    );

    const result = await createConfiguration('p1', { elitea_title: 'My Config', type: 'sharepoint', data: { url: 'x' } });
    expect(result).toEqual({ id: '1', type: 'sharepoint', elitea_title: 'My Config' });
  });
});

describe('testConfigurationConnection', () => {
  it('POSTs to /configurations/check_connection/{projectId}/{configType}', async () => {
    server.use(http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () => HttpResponse.json({ tools: ['a', 'b'] })));

    const result = await testConfigurationConnection('p1', 'sharepoint', { url: 'x' });
    expect(result).toEqual({ tools: ['a', 'b'] });
  });

  it('surfaces an error on failure', async () => {
    server.use(http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () => HttpResponse.json({ error: 'bad creds' }, { status: 400 })));

    await expect(testConfigurationConnection('p1', 'sharepoint', {})).rejects.toThrow();
  });
});

describe('buildConfigurationsListUrl', () => {
  it('builds the paginated list URL with include_shared=false and no section by default', () => {
    expect(buildConfigurationsListUrl({ projectId: 'p1' })).toBe(
      '/configurations/configurations/p1?include_shared=false&shared_offset=0&shared_limit=20&limit=20&offset=0',
    );
  });

  it('appends section when given', () => {
    expect(buildConfigurationsListUrl({ projectId: 'p1', section: 'credentials' })).toBe(
      '/configurations/configurations/p1?include_shared=false&shared_offset=0&shared_limit=20&limit=20&offset=0&section=credentials',
    );
  });
});

describe('getConfigurationsList', () => {
  it('GETs the list URL and unwraps the envelope', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/p1', () =>
        HttpResponse.json({ items: [{ type: 'sharepoint' }], total: 1, limit: 20, offset: 0 }),
      ),
    );

    const result = await getConfigurationsList({ projectId: 'p1', section: 'credentials' });
    expect(result).toEqual({ items: [{ type: 'sharepoint' }], total: 1, limit: 20, offset: 0 });
  });
});

describe('getAvailableConfigurationsType', () => {
  it('GETs /configurations/available/ with each section repeated as a query param', async () => {
    server.use(
      http.get('*/api/v2/configurations/available/', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.getAll('section')).toEqual(['credentials', 'llm']);
        return HttpResponse.json([{ type: 'sharepoint', config_schema: {} }]);
      }),
    );

    const result = await getAvailableConfigurationsType({ section: ['credentials', 'llm'] });
    expect(result).toEqual([{ type: 'sharepoint', config_schema: {} }]);
  });
});
