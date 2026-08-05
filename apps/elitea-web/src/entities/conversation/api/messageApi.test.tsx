import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { deleteAllMessagesFromConversation, deleteMessageFromConversation, messageList, useMessageListQuery } from './messageApi';

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

describe('messageList', () => {
  it('GETs with limit/offset computed from page * pageSize', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await messageList({ projectId: 7, conversationId: 1, page: 2, pageSize: 10 });
    expect(capturedUrl).toContain('limit=10');
    expect(capturedUrl).toContain('offset=20');
  });

  it('defaults pageSize to 10', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await messageList({ projectId: 7, conversationId: 1, page: 0 });
    expect(capturedUrl).toContain('limit=10');
    expect(capturedUrl).toContain('offset=0');
  });
});

describe('useMessageListQuery', () => {
  it('fetches and resolves', async () => {
    server.use(http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, () => HttpResponse.json([{ id: 'm1' }])));
    const { result } = renderHook(() => useMessageListQuery({ projectId: 7, conversationId: 1, page: 0 }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'm1' }]);
  });

  it('stays disabled when explicitly disabled', () => {
    const { result } = renderHook(() => useMessageListQuery({ projectId: 7, conversationId: 1, page: 0 }, { enabled: false }), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('deleteMessageFromConversation', () => {
  it('DELETEs elitea_core/message/prompt_lib/{projectId}/{id}', async () => {
    server.use(http.delete(`${BASE}/elitea_core/message/prompt_lib/7/m1`, () => HttpResponse.json({})));
    await expect(deleteMessageFromConversation({ projectId: 7, id: 'm1' })).resolves.toEqual({});
  });
});

describe('deleteAllMessagesFromConversation', () => {
  it('DELETEs elitea_core/messages/prompt_lib/{projectId}/{conversationId}', async () => {
    server.use(http.delete(`${BASE}/elitea_core/messages/prompt_lib/7/1`, () => HttpResponse.json({})));
    await expect(deleteAllMessagesFromConversation({ projectId: 7, conversationId: 1 })).resolves.toEqual({});
  });
});
