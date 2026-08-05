import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import type { SharepointResolvedConfig } from './useResolvedSharepointConfig.hooks';
import { authRequiredErrorData, useSharepointCheckConnection } from './useSharepointCheckConnection.hooks';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

const spConfig: SharepointResolvedConfig = {
  oauth_discovery_endpoint: 'https://login.microsoftonline.com/tenant',
  site_url: 'https://contoso.sharepoint.com',
  configuration_uuid: 'uuid-1',
};

describe('useSharepointCheckConnection', () => {
  it('does nothing when spConfig or projectId is missing', async () => {
    const { result } = renderHook(() => useSharepointCheckConnection({ projectId: undefined, spConfig }));
    await act(async () => {
      await result.current.runCheck();
    });
    expect(result.current.isRunning).toBe(false);
  });

  it('calls onSuccess when the connection test succeeds', async () => {
    server.use(http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', () => HttpResponse.json({})));
    const onSuccess = vi.fn();
    const { result } = renderHook(() => useSharepointCheckConnection({ projectId: 'proj-1', spConfig, onSuccess }));

    await act(async () => {
      await result.current.runCheck();
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.isRunning).toBe(false);
  });

  describe('REAL, CURRENT GAP (module doc comment): a live 401 never reaches handleConfigAuthRequired', () => {
    it('does NOT call handleConfigAuthRequired for a real 401 response, because http.ts\'s reauth interceptor strips the body before this hook\'s catch block ever sees it', async () => {
      server.use(
        http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', () =>
          HttpResponse.json(
            { requires_authorization: true, auth_metadata: { server_url: 'https://x', resource_metadata: {} } },
            { status: 401 },
          ),
        ),
      );
      const handleConfigAuthRequired = vi.fn();
      const { result } = renderHook(() => useSharepointCheckConnection({ projectId: 'proj-1', spConfig }));

      await act(async () => {
        await result.current.runCheck(handleConfigAuthRequired, 'token-key-1');
      });

      // `configureGeneratedClient({ baseUrl: '/api/v2' })` (this file's own
      // `beforeEach`) supplies no `reauthenticate` callback, so `http.ts`'s
      // `runReauth()` resolves `false` immediately and every 401 becomes
      // `EliteaApiError({ failure: { kind: 'auth', status: 401, url } })` —
      // no `body` field at all. `authRequiredErrorData` (tested directly,
      // below) correctly finds nothing to report in that shape, so
      // `handleConfigAuthRequired` is never invoked. This is the SAME gap
      // `features/agents/model/useCreateConfiguration.ts`'s own
      // `isAuthRequiredError` doc comment discloses for the identical
      // `/configurations/check_connection` endpoint — not a defect
      // introduced by this port.
      expect(handleConfigAuthRequired).not.toHaveBeenCalled();
    });
  });

  describe('authRequiredErrorData (pure) — proves the detection logic itself is correct and forward-compatible', () => {
    it('extracts the body from an EliteaApiError-shaped http failure with requires_authorization: true', () => {
      const caught = { failure: { kind: 'http', status: 401, body: { requires_authorization: true, auth_metadata: { server_url: 'https://x' } } } };
      expect(authRequiredErrorData(caught)).toEqual({ requires_authorization: true, auth_metadata: { server_url: 'https://x' } });
    });

    it('returns undefined for an EliteaApiError-shaped auth failure with no body (the real, current http.ts shape)', () => {
      const caught = { failure: { kind: 'auth', status: 401 } };
      expect(authRequiredErrorData(caught)).toBeUndefined();
    });

    it('returns undefined for an EliteaApiError-shaped http failure whose body lacks requires_authorization', () => {
      const caught = { failure: { kind: 'http', status: 401, body: { error: 'bad credentials' } } };
      expect(authRequiredErrorData(caught)).toBeUndefined();
    });

    it('returns undefined for a non-401 EliteaApiError-shaped failure', () => {
      const caught = { failure: { kind: 'http', status: 400, body: { requires_authorization: true } } };
      expect(authRequiredErrorData(caught)).toBeUndefined();
    });

    it('extracts a plain object with requires_authorization: true directly (baseline shape, forward-compatibility branch)', () => {
      const caught = { requires_authorization: true, auth_metadata: {} };
      expect(authRequiredErrorData(caught)).toBe(caught);
    });

    it('returns undefined for a plain error with no requires_authorization', () => {
      expect(authRequiredErrorData(new Error('network error'))).toBeUndefined();
      expect(authRequiredErrorData(undefined)).toBeUndefined();
      expect(authRequiredErrorData(null)).toBeUndefined();
    });
  });

  it('silently ignores a non-auth error (e.g. 400) without calling handleConfigAuthRequired', async () => {
    server.use(
      http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', () => HttpResponse.json({ error: 'bad' }, { status: 400 })),
    );
    const handleConfigAuthRequired = vi.fn();
    const { result } = renderHook(() => useSharepointCheckConnection({ projectId: 'proj-1', spConfig }));

    await act(async () => {
      await result.current.runCheck(handleConfigAuthRequired);
    });

    expect(handleConfigAuthRequired).not.toHaveBeenCalled();
  });

  it('sets isRunning true while the request is in flight', async () => {
    let resolveRequest: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    server.use(
      http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', async () => {
        await pending;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHook(() => useSharepointCheckConnection({ projectId: 'proj-1', spConfig }));

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.runCheck();
    });

    await waitFor(() => expect(result.current.isRunning).toBe(true));

    resolveRequest();
    await act(async () => {
      await runPromise;
    });

    expect(result.current.isRunning).toBe(false);
  });

  it('ignores a concurrent runCheck call while one is already in flight', async () => {
    let resolveRequest: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    let requestCount = 0;
    server.use(
      http.post('*/api/v2/configurations/check_connection/proj-1/sharepoint', async () => {
        requestCount += 1;
        await pending;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHook(() => useSharepointCheckConnection({ projectId: 'proj-1', spConfig }));

    let firstRun!: Promise<void>;
    act(() => {
      firstRun = result.current.runCheck();
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      await result.current.runCheck();
    });

    resolveRequest();
    await act(async () => {
      await firstRun;
    });

    expect(requestCount).toBe(1);
  });
});
