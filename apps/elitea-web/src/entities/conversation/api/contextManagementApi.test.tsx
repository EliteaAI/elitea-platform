import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  deleteSummary,
  generateSummary,
  getContextAnalytics,
  getContextStatus,
  getConversationSummaries,
  optimizeContext,
  updateContextStrategy,
  updateSummary,
  useGetContextStatusQuery,
} from './contextManagementApi';

const BASE = '/api/v2';

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('getContextStatus', () => {
  it('GETs elitea_core/context_analytics/prompt_lib/{projectId}/{conversationId} (baseline naming mismatch preserved)', async () => {
    server.use(http.get(`${BASE}/elitea_core/context_analytics/prompt_lib/7/1`, () => HttpResponse.json({ strategy: 'summarize' })));
    await expect(getContextStatus({ projectId: 7, conversationId: 1 })).resolves.toEqual({ strategy: 'summarize' });
  });
});

describe('useGetContextStatusQuery', () => {
  it('resolves via the hook', async () => {
    server.use(http.get(`${BASE}/elitea_core/context_analytics/prompt_lib/7/1`, () => HttpResponse.json({ strategy: 'summarize' })));
    const { result } = renderHook(() => useGetContextStatusQuery({ projectId: 7, conversationId: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ strategy: 'summarize' });
  });
});

describe('updateContextStrategy', () => {
  it('PUTs elitea_core/context_strategy/prompt_lib/{projectId}/{conversationId}', async () => {
    server.use(http.put(`${BASE}/elitea_core/context_strategy/prompt_lib/7/1`, () => HttpResponse.json({ ok: true })));
    await expect(updateContextStrategy({ projectId: 7, conversationId: 1, strategy: 'sliding_window' })).resolves.toEqual({ ok: true });
  });
});

describe('optimizeContext', () => {
  it('POSTs context_manager/optimize_context/{projectId}/{conversationId} — NOT under elitea_core', async () => {
    server.use(http.post(`${BASE}/context_manager/optimize_context/7/1`, () => HttpResponse.json({ ok: true })));
    await expect(optimizeContext({ projectId: 7, conversationId: 1 })).resolves.toEqual({ ok: true });
  });
});

describe('getContextAnalytics', () => {
  it('GETs context_manager/analytics/{projectId}/{conversationId}', async () => {
    server.use(http.get(`${BASE}/context_manager/analytics/7/1`, () => HttpResponse.json({ tokens: 100 })));
    await expect(getContextAnalytics({ projectId: 7, conversationId: 1 })).resolves.toEqual({ tokens: 100 });
  });
});

describe('generateSummary', () => {
  it('POSTs context_manager/summaries/{projectId}/{conversationId}', async () => {
    server.use(http.post(`${BASE}/context_manager/summaries/7/1`, () => HttpResponse.json({ id: 's1' })));
    await expect(generateSummary({ projectId: 7, conversationId: 1 })).resolves.toEqual({ id: 's1' });
  });
});

describe('getConversationSummaries', () => {
  it('GETs with limit/offset defaults', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/context_manager/summaries/7/1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ summaries: [] });
      }),
    );
    await getConversationSummaries({ projectId: 7, conversationId: 1 });
    expect(capturedUrl).toContain('limit=10');
    expect(capturedUrl).toContain('offset=0');
  });
});

describe('updateSummary / deleteSummary', () => {
  it('PUTs context_manager/summary/{projectId}/{conversationId}/{summaryId}', async () => {
    server.use(http.put(`${BASE}/context_manager/summary/7/1/s1`, () => HttpResponse.json({ id: 's1', text: 'new' })));
    await expect(updateSummary({ projectId: 7, conversationId: 1, summaryId: 's1', text: 'new' })).resolves.toEqual({ id: 's1', text: 'new' });
  });

  it('DELETEs context_manager/summary/{projectId}/{conversationId}/{summaryId}', async () => {
    server.use(http.delete(`${BASE}/context_manager/summary/7/1/s1`, () => HttpResponse.json({})));
    await expect(deleteSummary({ projectId: 7, conversationId: 1, summaryId: 's1' })).resolves.toEqual({});
  });
});
