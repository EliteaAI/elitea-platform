/**
 * XPORT-002/003 coverage — raw-fetch discovery against an arbitrary
 * (mocked) third-party MCP server origin.
 */
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';

import { createMcpDiscoveryClient, discoverServerCapabilities, extractBaseUrl, fetchJson, testApiKeyEndpoints } from './remoteDiscoveryClient';

const ORIGIN = 'https://mcp.example.com';

describe('extractBaseUrl', () => {
  it('strips path/query, keeping scheme+host(+port)', () => {
    expect(extractBaseUrl('https://mcp.example.com:8443/sse?token=abc')).toBe('https://mcp.example.com:8443');
  });

  it('falls back to a regex extraction on an unparseable URL', () => {
    expect(extractBaseUrl('not a url at all')).toBe('not a url at all');
  });
});

describe('fetchJson', () => {
  it('resolves with the parsed JSON body on a 2xx response', async () => {
    server.use(http.get(`${ORIGIN}/ok`, () => HttpResponse.json({ hello: 'world' })));
    await expect(fetchJson(`${ORIGIN}/ok`)).resolves.toEqual({ hello: 'world' });
  });

  it('rejects with the status and body text on a non-2xx response', async () => {
    server.use(http.get(`${ORIGIN}/broken`, () => HttpResponse.text('server exploded', { status: 500 })));
    await expect(fetchJson(`${ORIGIN}/broken`)).rejects.toThrow(/HTTP 500/);
  });
});

describe('discoverServerCapabilities', () => {
  it('prefers MCP-protocol discovery (.well-known/mcp) when it responds', async () => {
    server.use(
      http.get(`${ORIGIN}/.well-known/mcp`, () =>
        HttpResponse.json({ auth_method: 'oauth', capabilities: ['tools/list'] }),
      ),
    );

    const result = await discoverServerCapabilities(ORIGIN);
    expect(result.discoveredVia).toBe('mcp-discovery');
    expect(result.authMethod).toBe('oauth');
    expect(result.capabilities).toEqual(['tools/list']);
  });

  it('falls back to OAuth discovery when no MCP well-known path responds', async () => {
    server.use(
      ...['/.well-known/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp/'].map((path) =>
        http.get(`${ORIGIN}${path}`, () => HttpResponse.text('not found', { status: 404 })),
      ),
      http.get(`${ORIGIN}/.well-known/oauth-authorization-server`, () =>
        HttpResponse.json({ authorization_endpoint: 'https://mcp.example.com/authorize', token_endpoint: 'https://mcp.example.com/token' }),
      ),
    );

    const result = await discoverServerCapabilities(ORIGIN);
    expect(result.discoveredVia).toBe('oauth-discovery');
    expect(result.authorization_endpoint).toBe('https://mcp.example.com/authorize');
  });

  it('falls back to open access when nothing responds at all', async () => {
    const notFound = () => HttpResponse.text('nope', { status: 404 });
    server.use(
      http.get(`${ORIGIN}/.well-known/mcp`, notFound),
      http.get(`${ORIGIN}/.well-known/oauth-protected-resource`, notFound),
      http.get(`${ORIGIN}/.well-known/oauth-protected-resource/mcp/`, notFound),
      http.get(`${ORIGIN}/.well-known/oauth-authorization-server`, notFound),
      http.get(`${ORIGIN}/.well-known/openid-configuration`, notFound),
      http.get(`${ORIGIN}/oauth/.well-known/openid-configuration`, notFound),
      http.get(`${ORIGIN}/health`, notFound),
      http.get(`${ORIGIN}/status`, notFound),
      http.get(`${ORIGIN}/api/v1/health`, notFound),
      http.get(`${ORIGIN}/api/health`, notFound),
    );

    const result = await discoverServerCapabilities(ORIGIN);
    expect(result.discoveredVia).toBe('open-access');
    expect(result.authMethod).toBe('open');
  });
});

describe('testApiKeyEndpoints', () => {
  it('true when an unauthenticated probe fails but an API-key header succeeds', async () => {
    server.use(
      http.get(`${ORIGIN}/health`, ({ request }) => {
        const hasKey = request.headers.get('X-API-Key') === 'test-key';
        return hasKey ? HttpResponse.json({ ok: true }) : HttpResponse.text('unauthorized', { status: 401 });
      }),
    );
    await expect(testApiKeyEndpoints(ORIGIN)).resolves.toBe(true);
  });

  it('true when the unauthenticated 401 advertises an api/key/token WWW-Authenticate challenge', async () => {
    server.use(
      http.get(`${ORIGIN}/health`, () =>
        HttpResponse.text('unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'ApiKey realm="mcp"' } }),
      ),
    );
    await expect(testApiKeyEndpoints(ORIGIN)).resolves.toBe(true);
  });

  it('throws when no candidate endpoint gives any signal', async () => {
    const notFound = () => HttpResponse.text('nope', { status: 404 });
    server.use(
      http.get(`${ORIGIN}/health`, notFound),
      http.get(`${ORIGIN}/status`, notFound),
      http.get(`${ORIGIN}/api/v1/health`, notFound),
      http.get(`${ORIGIN}/api/health`, notFound),
    );
    await expect(testApiKeyEndpoints(ORIGIN)).rejects.toThrow('No API key endpoints found');
  });
});

describe('createMcpDiscoveryClient', () => {
  it('memoises discoverCapabilities — a second call does not re-fetch', async () => {
    let hits = 0;
    server.use(
      http.get(`${ORIGIN}/.well-known/mcp`, () => {
        hits += 1;
        return HttpResponse.json({ auth_method: 'oauth' });
      }),
    );

    const client = createMcpDiscoveryClient(ORIGIN);
    const first = await client.discoverCapabilities();
    const second = await client.discoverCapabilities();

    expect(first).toBe(second);
    expect(hits).toBe(1);
  });

  it('normalises a trailing slash on the server URL before use', async () => {
    server.use(http.get(`${ORIGIN}/.well-known/mcp`, () => HttpResponse.json({ auth_method: 'oauth' })));
    const client = createMcpDiscoveryClient(`${ORIGIN}/`);
    await expect(client.discoverCapabilities()).resolves.toMatchObject({ authMethod: 'oauth' });
  });

  it('resolves to the open-access fallback (never rejects) even when every well-known path is unhandled', async () => {
    // No handlers registered for this origin -> every cascade step's own
    // try/catch swallows the failure; discoverServerCapabilities is
    // constructed to never throw (see createMcpDiscoveryClient's doc comment).
    const client = createMcpDiscoveryClient('https://totally-unhandled.example.com');
    await expect(client.discoverCapabilities()).resolves.toMatchObject({ discoveredVia: 'open-access' });
  });
});
