import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';

import { registerDynamicClient } from './registerDynamicClient';

afterEach(() => {
  resetGeneratedClient();
});

describe('registerDynamicClient', () => {
  it('registers via the DCR proxy and returns the issued client_id', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let capturedBody: unknown;
    server.use(
      http.post('*/api/v2/elitea_core/mcp_dcr_proxy/4', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ client_id: 'issued-client-id' });
      }),
    );

    const clientId = await registerDynamicClient('https://as.example.com/register', 'https://app.example.com/mcp-auth-callback', 4);

    expect(clientId).toBe('issued-client-id');
    expect(capturedBody).toMatchObject({
      registration_endpoint: 'https://as.example.com/register',
      redirect_uris: ['https://app.example.com/mcp-auth-callback'],
      client_name: 'ELITEA MCP Client',
      token_endpoint_auth_method: 'none',
    });
  });

  it('defaults projectId to 1 when omitted', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let capturedUrl = '';
    server.use(
      http.post('*/api/v2/elitea_core/mcp_dcr_proxy/1', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ client_id: 'cid' });
      }),
    );

    await registerDynamicClient('https://as.example.com/register', 'https://app.example.com/cb', undefined);
    expect(capturedUrl).toContain('/elitea_core/mcp_dcr_proxy/1');
  });

  it('throws when the proxy response has no client_id', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(http.post('*/api/v2/elitea_core/mcp_dcr_proxy/2', () => HttpResponse.json({})));

    await expect(
      registerDynamicClient('https://as.example.com/register', 'https://app.example.com/cb', 2),
    ).rejects.toThrow('Registration response missing client_id');
  });
});
