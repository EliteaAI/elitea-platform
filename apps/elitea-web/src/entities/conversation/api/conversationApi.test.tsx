import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import {
  conversationCreate,
  conversationDetails,
  conversationEdit,
  deleteConversation,
  regenerate,
  selectConversation,
  stopChatTask,
  unselectConversation,
  useConversationCreateMutation,
} from './conversationApi';

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

describe('conversationCreate', () => {
  it('POSTs to elitea_core/conversations/prompt_lib/{projectId} with the body sans projectId', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/elitea_core/conversations/prompt_lib/7`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: 1, name: 'New' });
      }),
    );
    const result = await conversationCreate({ projectId: 7, name: 'New', is_private: true });
    expect(result).toEqual({ id: 1, name: 'New' });
    expect(capturedBody).toEqual({ name: 'New', is_private: true });
  });
});

describe('useConversationCreateMutation', () => {
  it('resolves via the hook', async () => {
    server.use(http.post(`${BASE}/elitea_core/conversations/prompt_lib/7`, () => HttpResponse.json({ id: 1, name: 'New' })));
    const { result } = renderHook(() => useConversationCreateMutation(), { wrapper: createWrapper() });
    result.current.mutate({ projectId: 7, name: 'New', is_private: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: 1, name: 'New' });
  });
});

describe('conversationEdit', () => {
  it('PUTs to elitea_core/conversation/prompt_lib/{projectId}/{id}', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, () => HttpResponse.json({ id: 1, name: 'Renamed' })));
    const result = await conversationEdit({ projectId: 7, id: 1, name: 'Renamed' });
    expect(result).toEqual({ id: 1, name: 'Renamed' });
  });
});

describe('deleteConversation', () => {
  it('DELETEs elitea_core/conversation/prompt_lib/{projectId}/{id}', async () => {
    server.use(http.delete(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, () => HttpResponse.json({})));
    await expect(deleteConversation({ projectId: 7, id: 1 })).resolves.toEqual({});
  });
});

describe('conversationDetails', () => {
  it('GETs elitea_core/conversation/prompt_lib/{projectId}/{id} with no query when no optional params are given', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ id: 1, name: 'Conv' });
      }),
    );
    const result = await conversationDetails({ projectId: 7, id: 1 });
    expect(result).toEqual({ id: 1, name: 'Conv' });
    expect(capturedUrl).not.toContain('?');
  });

  it('includes messages_offset/messages_limit/sort_order when given', async () => {
    let capturedUrl = '';
    server.use(
      http.get(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ id: 1 });
      }),
    );
    await conversationDetails({ projectId: 7, id: 1, messages_offset: 0, messages_limit: 10, sort_order: 'desc' });
    expect(capturedUrl).toContain('messages_offset=0');
    expect(capturedUrl).toContain('messages_limit=10');
    expect(capturedUrl).toContain('sort_order=desc');
  });
});

describe('selectConversation / unselectConversation', () => {
  it('POSTs an empty body to select_conversation', async () => {
    let capturedBody: unknown;
    server.use(
      http.post(`${BASE}/elitea_core/select_conversation/prompt_lib/7/1`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({});
      }),
    );
    await selectConversation({ projectId: 7, conversationId: 1 });
    expect(capturedBody).toEqual({});
  });

  it('DELETEs select_conversation with no conversation id', async () => {
    server.use(http.delete(`${BASE}/elitea_core/select_conversation/prompt_lib/7`, () => HttpResponse.json({})));
    await expect(unselectConversation({ projectId: 7 })).resolves.toEqual({});
  });
});

describe('regenerate', () => {
  it('POSTs elitea_core/regenerate/prompt_lib/{projectId}/{id}', async () => {
    server.use(http.post(`${BASE}/elitea_core/regenerate/prompt_lib/7/1`, () => HttpResponse.json({ ok: true })));
    await expect(regenerate({ projectId: 7, id: 1 })).resolves.toEqual({ ok: true });
  });
});

describe('stopChatTask', () => {
  it('DELETEs the same route as pipelines.stopLlmTask (elitea_core/task/prompt_lib/{projectId}/{taskId})', async () => {
    server.use(http.delete(`${BASE}/elitea_core/task/prompt_lib/7/mg-1`, () => HttpResponse.json({})));
    await expect(stopChatTask({ projectId: 7, messageGroupUuid: 'mg-1' })).resolves.toEqual({});
  });
});
