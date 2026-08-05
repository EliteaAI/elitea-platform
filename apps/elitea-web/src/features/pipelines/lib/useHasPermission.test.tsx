import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useHasPermission } from './useHasPermission';

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

describe('useHasPermission', () => {
  it('is false while projectId is undefined', () => {
    const { result } = renderHook(() => useHasPermission(undefined, 'models.applications.application.update'), { wrapper });
    expect(result.current).toBe(false);
  });

  it('is true when the permission list includes an enabled matching entry', async () => {
    server.use(
      http.get('*/auth/permissions/prompt_lib/:projectId', () =>
        HttpResponse.json([{ name: 'models.applications.application.update', enabled: true }], { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useHasPermission('p1', 'models.applications.application.update'), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false when the matching entry is disabled', async () => {
    server.use(
      http.get('*/auth/permissions/prompt_lib/:projectId', () =>
        HttpResponse.json([{ name: 'models.applications.application.update', enabled: false }], { status: 200 }),
      ),
    );
    const { result } = renderHook(() => useHasPermission('p1', 'models.applications.application.update'), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
