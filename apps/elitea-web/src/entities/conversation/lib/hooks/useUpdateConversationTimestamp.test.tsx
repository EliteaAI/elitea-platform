import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useUpdateConversationTimestamp } from './useUpdateConversationTimestamp';

const BASE = '/api/v2';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useUpdateConversationTimestamp', () => {
  it('PUTs the conversation with a _timestamp_update field', async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ id: 1 });
      }),
    );
    const { result } = renderHook(() => useUpdateConversationTimestamp(7));
    await act(async () => result.current.updateConversationTimestamp(1));
    expect(capturedBody).toHaveProperty('_timestamp_update');
  });

  it('is a no-op when conversationId is missing', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, () => HttpResponse.json({ id: 1 })));
    const { result } = renderHook(() => useUpdateConversationTimestamp(7));
    await expect(act(async () => result.current.updateConversationTimestamp(undefined))).resolves.toBeUndefined();
  });

  it('is a no-op when projectId is missing', async () => {
    const { result } = renderHook(() => useUpdateConversationTimestamp(undefined));
    await expect(act(async () => result.current.updateConversationTimestamp(1))).resolves.toBeUndefined();
  });

  it('swallows a request failure silently', async () => {
    server.use(http.put(`${BASE}/elitea_core/conversation/prompt_lib/7/1`, () => HttpResponse.json({ error: 'nope' }, { status: 500 })));
    const { result } = renderHook(() => useUpdateConversationTimestamp(7));
    await expect(act(async () => result.current.updateConversationTimestamp(1))).resolves.toBeUndefined();
  });
});
