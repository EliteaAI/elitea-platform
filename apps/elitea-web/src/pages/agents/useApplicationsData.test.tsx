import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getListApplicationsMockHandler,
  getListPublicApplicationsMockHandler,
} from '@/shared/api/generated/applications/applications.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import { useApplicationsData } from './useApplicationsData';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(publicProjectId: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: publicProjectId,
  };
  resetConfigForTests();
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  setConfig('1');
});

afterEach(() => {
  resetGeneratedClient();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
});

describe('useApplicationsData', () => {
  it('resolves latestTotal from the public endpoint on the public project', async () => {
    server.use(getListPublicApplicationsMockHandler({ rows: [], total: 7 }));
    const { result } = renderHook(() => useApplicationsData('1', false), { wrapper });
    await waitFor(() => expect(result.current.latestTotal).toBe(7));
    expect(result.current.myLikedTotal).toBeUndefined();
    expect(result.current.trendingTotal).toBeUndefined();
  });

  it('resolves applicationsTotal from the private-project endpoint on a private project', async () => {
    server.use(
      getListApplicationsMockHandler({ rows: [], total: 3, page: 1, page_size: 20, total_pages: 1 }),
    );
    const { result } = renderHook(() => useApplicationsData('9', false), { wrapper });
    await waitFor(() => expect(result.current.applicationsTotal).toBe(3));
    expect(result.current.latestTotal).toBeUndefined();
  });

  it('the five per-status totals are always undefined — no server-side status filter exists', async () => {
    server.use(
      getListApplicationsMockHandler({ rows: [], total: 3, page: 1, page_size: 20, total_pages: 1 }),
    );
    const { result } = renderHook(() => useApplicationsData('9', false), { wrapper });
    await waitFor(() => expect(result.current.applicationsTotal).toBe(3));
    expect(result.current.draftTotal).toBeUndefined();
    expect(result.current.publishedTotal).toBeUndefined();
    expect(result.current.moderationTotal).toBeUndefined();
    expect(result.current.approvalTotal).toBeUndefined();
    expect(result.current.rejectedTotal).toBeUndefined();
  });

  it('fetches applicationsTotal on the public project only when the caller has admin permission', async () => {
    server.use(
      getListPublicApplicationsMockHandler({ rows: [], total: 0 }),
      getListApplicationsMockHandler({ rows: [], total: 5, page: 1, page_size: 20, total_pages: 1 }),
    );
    const { result } = renderHook(() => useApplicationsData('1', true), { wrapper });
    await waitFor(() => expect(result.current.applicationsTotal).toBe(5));
  });

  it('does not fetch anything while projectId is undefined', () => {
    const { result } = renderHook(() => useApplicationsData(undefined, false), { wrapper });
    expect(result.current.latestTotal).toBeUndefined();
    expect(result.current.applicationsTotal).toBeUndefined();
  });
});
