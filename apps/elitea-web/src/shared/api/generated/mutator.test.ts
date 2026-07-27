/**
 * mutator.test.ts — coverage for the hand-written `eliteaFetch` adapter
 * (unit S4). Not generated, so it carries the ≥90% infra floor the S4 task
 * sets for this file, same as F4's http.test.ts covers http.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import {
  TRANSPORT_PROBE_PATH,
  probeAny,
  probeAuthGated,
  probeNetworkError,
  probeNeverending,
  probeNotFound,
  probeOk,
} from '../../../test/msw/handlers/transport';
import type { CapturedRequest } from '../../../test/msw/handlers/transport';

import { EliteaApiError, configureGeneratedClient, eliteaFetch, resetGeneratedClient } from './mutator';

const PROBE_PATH = TRANSPORT_PROBE_PATH.replace('/api/v2', '');

afterEach(() => {
  resetGeneratedClient();
});

describe('client injection (R-S2: factory + inject, no module-scope construction)', () => {
  it('throws a clear error when no client has been configured', async () => {
    await expect(eliteaFetch(PROBE_PATH, { method: 'GET' })).rejects.toThrow(
      /no HttpClient configured — call configureGeneratedClient/,
    );
  });

  it('configureGeneratedClient returns the client it creates, and eliteaFetch then uses it', async () => {
    const client = configureGeneratedClient({ baseUrl: '/api/v2' });
    expect(client.baseUrl).toBe('/api/v2');
    server.use(probeOk());
    await expect(eliteaFetch(PROBE_PATH, { method: 'GET' })).resolves.toEqual({ message: 'transport probe ok' });
  });

  it('resetGeneratedClient forces the next call back to the unconfigured error', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    resetGeneratedClient();
    await expect(eliteaFetch(PROBE_PATH, { method: 'GET' })).rejects.toThrow(/no HttpClient configured/);
  });
});

describe('the fetch(url, options) contract orval\'s httpClient: \'fetch\' generator calls', () => {
  it('defaults to GET when options.method is omitted', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const sink: CapturedRequest[] = [];
    server.use(probeAny(sink));
    await eliteaFetch(PROBE_PATH, {});
    expect(sink[0]?.method).toBe('GET');
  });

  it('normalises a lower-case method to the upper-case HttpMethod union', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const sink: CapturedRequest[] = [];
    server.use(probeAny(sink));
    await eliteaFetch(PROBE_PATH, { method: 'post' });
    expect(sink[0]?.method).toBe('POST');
  });

  it('rejects a method outside GET/HEAD/POST/PUT/PATCH/DELETE with a clear TypeError', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    await expect(eliteaFetch(PROBE_PATH, { method: 'TRACE' })).rejects.toThrow(
      /unsupported HTTP method "TRACE"/,
    );
  });

  it('passes a Headers instance through as a plain record', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const sink: CapturedRequest[] = [];
    server.use(probeAny(sink));
    await eliteaFetch(PROBE_PATH, { method: 'GET', headers: new Headers({ 'X-Test': 'a' }) });
    expect(sink[0]).toBeDefined();
  });

  it('passes an already-JSON-stringified body through verbatim (orval pre-serialises)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const sink: CapturedRequest[] = [];
    server.use(probeAny(sink));
    await eliteaFetch(PROBE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(sink[0]?.bodyText).toBe('{"a":1}');
  });

  it('treats a null body (orval\'s GET-request shape) the same as no body', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    const sink: CapturedRequest[] = [];
    server.use(probeAny(sink));
    await eliteaFetch(PROBE_PATH, { method: 'GET', body: null });
    expect(sink[0]?.bodyText).toBeNull();
  });

  it('forwards signal so an aborted request rejects rather than hanging', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeNeverending());
    const controller = new AbortController();
    const pending = eliteaFetch(PROBE_PATH, { method: 'GET', signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(EliteaApiError);
  });
});

describe('§3.6 unwrap: HttpResult becomes a thrown EliteaApiError for react-query', () => {
  it('resolves with the parsed data on a 2xx (never a Result wrapper)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeOk());
    const data = await eliteaFetch<{ message: string }>(PROBE_PATH, { method: 'GET' });
    expect(data).toEqual({ message: 'transport probe ok' });
  });

  it('throws EliteaApiError carrying a kind:http failure for a 404', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeNotFound());
    const rejection = eliteaFetch(PROBE_PATH, { method: 'GET' });
    await expect(rejection).rejects.toThrow(EliteaApiError);
    await expect(rejection).rejects.toMatchObject({
      name: 'EliteaApiError',
      failure: { kind: 'http', status: 404 },
    });
  });

  it('message describes the http failure with status + url', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeNotFound());
    try {
      await eliteaFetch(PROBE_PATH, { method: 'GET' });
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EliteaApiError);
      expect((error as Error).message).toMatch(/^eliteaFetch: 404 from /);
    }
  });

  it('throws EliteaApiError carrying a kind:network failure, message included', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeNetworkError());
    try {
      await eliteaFetch(PROBE_PATH, { method: 'GET' });
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EliteaApiError);
      expect((error as EliteaApiError).failure.kind).toBe('network');
      expect((error as Error).message).toMatch(/^eliteaFetch: network error — /);
    }
  });

  it('throws EliteaApiError carrying a kind:auth failure for a 401 with no reauthenticate configured', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' }); // no `reauthenticate` — runReauth resolves false
    server.use(probeAuthGated({ authed: false }, 401));
    try {
      await eliteaFetch(PROBE_PATH, { method: 'GET' });
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EliteaApiError);
      expect((error as EliteaApiError).failure.kind).toBe('auth');
      expect((error as Error).message).toMatch(/^eliteaFetch: auth failure \(401\) from /);
    }
  });

  it('throws EliteaApiError carrying a kind:aborted failure, message included', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(probeNeverending());
    const controller = new AbortController();
    const pending = eliteaFetch(PROBE_PATH, { method: 'GET', signal: controller.signal });
    controller.abort();
    try {
      await pending;
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(EliteaApiError);
      expect((error as EliteaApiError).failure.kind).toBe('aborted');
      expect((error as Error).message).toMatch(/^eliteaFetch: aborted request to /);
    }
  });
});
