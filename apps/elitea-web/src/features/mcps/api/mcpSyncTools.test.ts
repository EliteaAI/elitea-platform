import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';

import { mcpSyncTools } from './mcpSyncTools';

afterEach(() => {
  resetGeneratedClient();
});

describe('mcpSyncTools', () => {
  it('POSTs to /elitea_core/mcp_sync_tools/prompt_lib/{projectId}?await_response=true by default', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let capturedUrl = '';
    let capturedBody: unknown;
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/9', async ({ request }) => {
        capturedUrl = request.url;
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, tools: [{ name: 'list_files' }] });
      }),
    );

    const result = await mcpSyncTools({ projectId: 9, url: 'https://mcp.example.com', toolkit_type: undefined });

    expect(capturedUrl).toContain('await_response=true');
    expect(capturedBody).toMatchObject({ url: 'https://mcp.example.com' });
    expect(result.success).toBe(true);
    expect(result.tools).toEqual([{ name: 'list_files' }]);
  });

  it('respects an explicit awaitResponse=false', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let capturedUrl = '';
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/2', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ success: true });
      }),
    );

    await mcpSyncTools({ projectId: 2, toolkit_type: 'mcp_github', awaitResponse: false });
    expect(capturedUrl).toContain('await_response=false');
  });

  it('surfaces requires_authorization in the response for the caller to branch on', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(
      http.post('*/api/v2/elitea_core/mcp_sync_tools/prompt_lib/3', () =>
        HttpResponse.json({ requires_authorization: true, response_metadata: { server_url: 'https://mcp.example.com' } }),
      ),
    );

    const result = await mcpSyncTools({ projectId: 3, url: 'https://mcp.example.com' });
    expect(result.requires_authorization).toBe(true);
  });
});
