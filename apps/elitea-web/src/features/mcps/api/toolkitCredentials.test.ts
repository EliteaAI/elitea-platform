import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';

import { getToolkitOAuthSettings } from './toolkitCredentials';

afterEach(() => {
  resetGeneratedClient();
});

describe('getToolkitOAuthSettings', () => {
  it('GETs /elitea_core/tool/prompt_lib/{projectId}/{toolkitId} and returns settings', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(
      http.get('*/api/v2/elitea_core/tool/prompt_lib/1/tk-1', () =>
        HttpResponse.json({ settings: { client_id: 'cid', client_secret: 'csecret', token_endpoint: 'https://t' } }),
      ),
    );

    const result = await getToolkitOAuthSettings(1, 'tk-1');
    expect(result).toEqual({ client_id: 'cid', client_secret: 'csecret', token_endpoint: 'https://t' });
  });

  it('returns null when the response has no settings', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(http.get('*/api/v2/elitea_core/tool/prompt_lib/1/tk-2', () => HttpResponse.json({})));

    expect(await getToolkitOAuthSettings(1, 'tk-2')).toBeNull();
  });

  it('returns null on a 404/error response rather than throwing (best-effort fallback)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(http.get('*/api/v2/elitea_core/tool/prompt_lib/1/missing', () => HttpResponse.json({ error: 'not found' }, { status: 404 })));

    await expect(getToolkitOAuthSettings(1, 'missing')).resolves.toBeNull();
  });
});
