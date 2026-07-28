import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGetAgentCategoriesMockHandler } from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useGetAgentCategoriesQuery, useLazyGetAgentCategoriesQuery } from './agentCategories';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useGetAgentCategoriesQuery', () => {
  it('fetches the {categories, total} envelope for a project', async () => {
    server.use(
      getGetAgentCategoriesMockHandler({
        categories: [{ name: 'Support', is_default: true }],
        total: 1,
      }),
    );
    const { result } = renderHook(() => useGetAgentCategoriesQuery({ projectId: 'proj-1' }), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toStrictEqual({
      categories: [{ name: 'Support', is_default: true }],
      total: 1,
    });
  });

  it('does not fire the query when skip is true', () => {
    const { result } = renderHook(() => useGetAgentCategoriesQuery({ projectId: 'proj-1' }, { skip: true }), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });
});

describe('useLazyGetAgentCategoriesQuery', () => {
  it('trigger(projectId) fetches and returns the categories payload imperatively', async () => {
    server.use(getGetAgentCategoriesMockHandler({ categories: [{ name: 'Marketing', is_default: false }], total: 1 }));
    const { result } = renderHook(() => useLazyGetAgentCategoriesQuery(), { wrapper: createWrapper() });

    const response = await result.current.trigger('proj-2');

    expect(response).toStrictEqual({ categories: [{ name: 'Marketing', is_default: false }], total: 1 });
  });
});
