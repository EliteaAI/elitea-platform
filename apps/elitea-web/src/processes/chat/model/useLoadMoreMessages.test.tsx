import { useState } from 'react';

import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useLoadMoreMessages } from './useLoadMoreMessages';
import type { LoadMoreMessagesConversation } from './useLoadMoreMessages';

const BASE = '/api/v2';

interface TestMessage {
  readonly id: string;
}

function convert(rows: readonly unknown[]): TestMessage[] {
  return rows.map((row) => ({ id: (row as { readonly id: string }).id }));
}

function useHarness(activeConversation: LoadMoreMessagesConversation | undefined, onError?: (error: unknown) => void) {
  const [messages, setMessages] = useState<readonly TestMessage[]>([{ id: 'existing' }]);
  const loadMore = useLoadMoreMessages<TestMessage>({
    projectId: 7,
    activeConversation,
    setChatHistory: (updater) => setMessages(updater),
    getMessageId: (m) => m.id,
    convertMessagesToChatHistory: convert,
    ...(onError ? { onError } : {}),
  });
  return { messages, ...loadMore };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useLoadMoreMessages', () => {
  it('fetches page 1, prepends deduped rows, and advances the page', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('offset')).toBe('10');
        return HttpResponse.json([{ id: 'older-2' }, { id: 'older-1' }]);
      }),
    );
    const { result } = renderHook(() => useHarness({ id: 1, messages_count: 25 }));

    await act(async () => {
      await result.current.onLoadMoreMessages();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['older-1', 'older-2', 'existing']);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('does not fetch (or dedupe again) once messages_count is exhausted', async () => {
    const { result } = renderHook(() => useHarness({ id: 1, messages_count: 5 }));
    await act(async () => {
      await result.current.onLoadMoreMessages();
    });
    expect(result.current.messages).toEqual([{ id: 'existing' }]);
  });

  it('is a no-op with no active conversation id', async () => {
    const { result } = renderHook(() => useHarness(undefined));
    await act(async () => {
      await result.current.onLoadMoreMessages();
    });
    expect(result.current.messages).toEqual([{ id: 'existing' }]);
  });

  it('dedupes rows already present in the current chat history', async () => {
    server.use(http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, () => HttpResponse.json([{ id: 'existing' }, { id: 'new' }])));
    const { result } = renderHook(() => useHarness({ id: 1, messages_count: 25 }));

    await act(async () => {
      await result.current.onLoadMoreMessages();
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['new', 'existing']);
  });

  it('invokes the caller-supplied callback before prepending', async () => {
    server.use(http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, () => HttpResponse.json([{ id: 'older' }])));
    const { result } = renderHook(() => useHarness({ id: 1, messages_count: 25 }));
    const callback = vi.fn();

    await act(async () => {
      await result.current.onLoadMoreMessages(callback);
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('calls onError and leaves history untouched when the fetch fails', async () => {
    server.use(http.get(`${BASE}/elitea_core/messages/prompt_lib/7/1`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    const onError = vi.fn();
    const { result } = renderHook(() => useHarness({ id: 1, messages_count: 25 }, onError));

    await act(async () => {
      await result.current.onLoadMoreMessages();
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([{ id: 'existing' }]);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('resets its page back to 1 when the active conversation id changes', async () => {
    let capturedOffsets: string[] = [];
    server.use(
      http.get(`${BASE}/elitea_core/messages/prompt_lib/7/:id`, ({ request }) => {
        capturedOffsets.push(new URL(request.url).searchParams.get('offset') ?? '');
        return HttpResponse.json([]);
      }),
    );
    const { result, rerender } = renderHook(({ conv }: { conv: LoadMoreMessagesConversation }) => useHarness(conv), {
      initialProps: { conv: { id: 1, messages_count: 25 } },
    });

    await act(async () => {
      await result.current.onLoadMoreMessages();
    });
    expect(capturedOffsets).toEqual(['10']);

    rerender({ conv: { id: 2, messages_count: 25 } });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));
    await act(async () => {
      await result.current.onLoadMoreMessages();
    });
    expect(capturedOffsets).toEqual(['10', '10']);
  });
});
