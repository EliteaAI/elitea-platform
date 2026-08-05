import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useValidatePipelineVersion } from './useValidatePipelineVersion';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useValidatePipelineVersion', () => {
  it('does not error and stays disabled while any id is undefined', () => {
    const { result } = renderHook(
      () => useValidatePipelineVersion({ projectId: undefined, applicationId: undefined, versionId: undefined }),
      { wrapper },
    );

    expect(result.current.isError).toBe(false);
  });

  it('reports no error for a valid version', async () => {
    server.use(
      http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ valid: true }, { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useValidatePipelineVersion({ projectId: 'p1', applicationId: 1, versionId: 2 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(false));
  });

  it('reports an error when the endpoint fails', async () => {
    server.use(
      http.get('*/elitea_core/version_validator/prompt_lib/:projectId/:applicationId/:versionId', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useValidatePipelineVersion({ projectId: 'p1', applicationId: 1, versionId: 2 }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });
});
