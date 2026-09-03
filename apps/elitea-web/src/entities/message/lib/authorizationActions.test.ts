import { describe, expect, it } from 'vitest';

import { buildAuthorizationActions } from './authorizationActions';

describe('buildAuthorizationActions', () => {
  it('builds every unique exact request from a parallel terminal event', () => {
    const actions = buildAuthorizationActions({
      authorization_requests: [
        {
          interrupt_id: 'auth-1',
          tool_call_id: 'call-1',
          tool_name: 'SharePoint search',
          toolkit_type: 'sharepoint',
          server_url: 'https://sharepoint.example.test',
          resource_metadata: {
            resource_name: 'SharePoint',
            authorization_servers: ['https://login.example.test'],
          },
        },
        {
          interrupt_id: 'auth-2',
          tool_call_id: 'call-2',
          tool_name: 'SharePoint list',
          toolkit_type: 'sharepoint',
          server_url: 'https://sharepoint.example.test',
          resource_metadata: {
            resource_name: 'SharePoint',
            authorization_servers: ['https://login.example.test'],
          },
        },
        { interrupt_id: 'auth-1' },
      ],
    }, 'Authorization required.', '2026-09-03T00:00:00Z');

    expect(actions.map((action) => action.authorizationRequestId)).toEqual(['auth-1', 'auth-2']);
    expect(actions.map((action) => (action.toolOutputs as Record<string, unknown>)['server_url']))
      .toEqual(['https://login.example.test', 'https://login.example.test']);
  });

  it('removes private credential values before rendering or persistence', () => {
    const [action] = buildAuthorizationActions({
      interrupt_id: 'auth-1',
      tool_name: 'Remote MCP',
      server_url: 'https://mcp.example.test',
      authorization_servers: ['https://login.example.test'],
      access_token: 'secret-access',
      proxyAuthorization: 'secret-proxy',
      resource_metadata: {
        authorization_servers: ['https://login.example.test'],
        provided_settings: {
          mcp_client_id: 'public-client',
          mcp_client_secret: 'secret-client',
          clientSecret: 'secret-camel-case',
        },
      },
    }, '', '2026-09-03T00:00:00Z');

    expect(JSON.stringify(action)).not.toContain('secret-access');
    expect(JSON.stringify(action)).not.toContain('secret-client');
    expect(JSON.stringify(action)).not.toContain('secret-camel-case');
    expect(JSON.stringify(action)).not.toContain('secret-proxy');
    expect(JSON.stringify(action)).toContain('public-client');
  });
});
