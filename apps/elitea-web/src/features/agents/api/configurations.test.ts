import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { createConfiguration, testConfigurationConnection } from './configurations';

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
    server.use(
      http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () => HttpResponse.json({ tools: ['a', 'b'] })),
    );

    const result = await testConfigurationConnection('p1', 'sharepoint', { url: 'x' });
    expect(result).toEqual({ tools: ['a', 'b'] });
  });

  it('surfaces an error body on failure', async () => {
    server.use(
      http.post('*/api/v2/configurations/check_connection/p1/sharepoint', () =>
        HttpResponse.json({ error: 'bad creds' }, { status: 400 }),
      ),
    );

    await expect(testConfigurationConnection('p1', 'sharepoint', {})).rejects.toThrow();
  });
});
