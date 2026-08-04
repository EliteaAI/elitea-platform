import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { server } from '../../../test/setup';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { useCredentialValidation } from './useCredentialValidation';

const BASE = '/api/v2';

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  resetGeneratedClient();
});

describe('useCredentialValidation', () => {
  it('starts idle for an unknown credential', () => {
    configureGeneratedClient({ baseUrl: BASE });
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });
    expect(result.current.getCredentialStatus('unknown')).toBe('idle');
    expect(result.current.getCredentialMessage('unknown')).toBe('');
  });

  it('transitions idle -> checking -> valid on a successful test-connection', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connection/7/openai`, () => HttpResponse.json({})));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });

    expect(result.current.getCredentialStatus('c1')).toBe('valid');
  });

  it('transitions to invalid and records the message on a reported error', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connection/7/openai`, () => HttpResponse.json({ error: 'bad key' })));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });

    expect(result.current.getCredentialStatus('c1')).toBe('invalid');
    expect(result.current.getCredentialMessage('c1')).toBe('bad key');
  });

  it('transitions to invalid and records the message on a thrown HTTP error (e.g. a 500)', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.post(`${BASE}/configurations/check_connection/7/openai`, () =>
        HttpResponse.json({ error: 'invalid credentials' }, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });

    expect(result.current.getCredentialStatus('c1')).toBe('invalid');
    expect(result.current.getCredentialMessage('c1')).toBe('invalid credentials');
  });

  it('falls back to the body `message` field when a thrown HTTP error has no `error` field', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.post(`${BASE}/configurations/check_connection/7/openai`, () =>
        HttpResponse.json({ message: 'server exploded' }, { status: 502 }),
      ),
    );
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });

    expect(result.current.getCredentialStatus('c1')).toBe('invalid');
    expect(result.current.getCredentialMessage('c1')).toBe('server exploded');
  });

  it('marks a 404 response as unsupported, not invalid', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connection/7/legacy`, () => new HttpResponse(null, { status: 404 })));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'legacy', data: {} });
    });

    expect(result.current.getCredentialStatus('c1')).toBe('unsupported');
  });

  it('is a no-op when the credential is already checking/valid/invalid/unsupported', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    let hits = 0;
    server.use(
      http.post(`${BASE}/configurations/check_connection/7/openai`, () => {
        hits += 1;
        return HttpResponse.json({});
      }),
    );
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });
    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });

    expect(hits).toBe(1);
  });

  it('resetStatus clears one credential back to idle', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connection/7/openai`, () => HttpResponse.json({})));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });
    expect(result.current.getCredentialStatus('c1')).toBe('valid');

    act(() => {
      result.current.resetStatus('c1');
    });
    expect(result.current.getCredentialStatus('c1')).toBe('idle');
  });

  it('resetStatuses clears every credential', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connection/7/openai`, () => HttpResponse.json({})));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.validateCredential({ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} });
    });
    act(() => {
      result.current.resetStatuses();
    });
    expect(result.current.getCredentialStatus('c1')).toBe('idle');
  });

  it('batchValidateCredentials groups by project and applies per-row results', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(
      http.post(`${BASE}/configurations/check_connections/7`, () =>
        HttpResponse.json([
          { id: 'c1', success: true },
          { id: 'c2', success: false, message: 'nope' },
        ]),
      ),
    );
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.batchValidateCredentials([
        { projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} },
        { projectId: 7, credentialId: 'c2', credentialType: 'azure', data: {} },
      ]);
    });

    expect(result.current.getCredentialStatus('c1')).toBe('valid');
    expect(result.current.getCredentialStatus('c2')).toBe('invalid');
    expect(result.current.getCredentialMessage('c2')).toBe('nope');
  });

  it('batchValidateCredentials skips items already validated', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    let hits = 0;
    server.use(
      http.post(`${BASE}/configurations/check_connections/7`, () => {
        hits += 1;
        return HttpResponse.json([{ id: 'c1', success: true }]);
      }),
    );
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.batchValidateCredentials([{ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} }]);
    });
    await act(async () => {
      await result.current.batchValidateCredentials([{ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} }]);
    });

    expect(hits).toBe(1);
  });

  it('marks unsupported rows from a batch result', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connections/7`, () => HttpResponse.json([{ id: 'c1', unsupported: true }])));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.batchValidateCredentials([{ projectId: 7, credentialId: 'c1', credentialType: 'legacy', data: {} }]);
    });

    expect(result.current.getCredentialStatus('c1')).toBe('unsupported');
  });

  it('marks every credential invalid when the batch request itself fails', async () => {
    configureGeneratedClient({ baseUrl: BASE });
    server.use(http.post(`${BASE}/configurations/check_connections/7`, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useCredentialValidation(), { wrapper });

    await act(async () => {
      await result.current.batchValidateCredentials([{ projectId: 7, credentialId: 'c1', credentialType: 'openai', data: {} }]);
    });

    await waitFor(() => expect(result.current.getCredentialStatus('c1')).toBe('invalid'));
  });
});
