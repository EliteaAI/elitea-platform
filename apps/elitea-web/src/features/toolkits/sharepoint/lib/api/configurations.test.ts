import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { getConfigurationsByType, testConfigurationConnection } from './configurations';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('getConfigurationsByType', () => {
  it('GETs /configurations/configurations/{projectId} with type/limit/offset query params', async () => {
    server.use(
      http.get('*/api/v2/configurations/configurations/p1', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('type')).toBe('sharepoint');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('offset')).toBe('0');
        return HttpResponse.json({
          items: [{ id: '1', type: 'sharepoint', uuid: 'uuid-1', elitea_title: 'My SP', data: { site_url: 'https://contoso.sharepoint.com' } }],
          total: 1,
          limit: 20,
          offset: 0,
        });
      }),
    );

    const result = await getConfigurationsByType('p1', 'sharepoint');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ uuid: 'uuid-1', elitea_title: 'My SP' });
  });
});

describe('testConfigurationConnection', () => {
  it('POSTs to /configurations/check_connection/{projectId}/{configType} with the body', async () => {
    server.use(
      http.post('*/api/v2/configurations/check_connection/p1/sharepoint', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body).toEqual({ site_url: 'https://contoso.sharepoint.com' });
        return HttpResponse.json({});
      }),
    );

    const result = await testConfigurationConnection('p1', 'sharepoint', { site_url: 'https://contoso.sharepoint.com' });
    expect(result).toEqual({});
  });

  it('surfaces a 401 requires_authorization failure by rejecting', async () => {
    server.use(
      http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () =>
        HttpResponse.json({ requires_authorization: true, auth_metadata: { server_url: 'https://x' } }, { status: 401 }),
      ),
    );

    await expect(testConfigurationConnection('p1', 'sharepoint', {})).rejects.toThrow();
  });
});
