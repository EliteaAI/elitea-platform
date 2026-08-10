/**
 * Neither playback hook had a test, and both carried the issue #132 defect
 * verbatim: `'rows' in response ? response.rows : response` against an endpoint
 * that answers `{items,total,page,page_size,total_pages}`. Neither arm matched,
 * so the ENVELOPE OBJECT was passed to `convertMessagesToChatHistory` — the
 * same read that crashed `/app/chat/:id`.
 *
 * These cases pin both hooks against all three shapes this API uses.
 */
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { useLoadPlaybackMessages } from './useLoadPlaybackMessages';
import { usePlaybackConversation } from './usePlaybackConversation';

const BASE = '/api/v2';
const PROJECT = '9';
const CONVERSATION = '3';

/** Two user message groups — the minimum `convertMessagesToChatHistory` turns into two chat messages. */
const GROUPS = [
  { id: 'g1', uuid: 'u1', content: 'first', created_at: '2026-08-01 10:00:00' },
  { id: 'g2', uuid: 'u2', content: 'second', created_at: '2026-08-01 10:01:00' },
];

const SHAPES: readonly (readonly [string, object])[] = [
  ['the {items,total,page,…} envelope this endpoint really returns', { items: GROUPS, total: 2, page: 1, page_size: 100, total_pages: 1 }],
  ['a {rows,total} envelope', { rows: GROUPS, total: 2 }],
  ['a bare array', GROUPS],
];

function wrapper({ children }: { readonly children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function handlers(body: object) {
  return [
    http.get(`${BASE}/elitea_core/conversation/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
      HttpResponse.json({ id: CONVERSATION, name: 'Replay', participants: [] }),
    ),
    http.get(`${BASE}/elitea_core/messages/prompt_lib/${PROJECT}/${CONVERSATION}`, () => HttpResponse.json(body)),
  ];
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('usePlaybackConversation', () => {
  it.each(SHAPES)('builds chat_history and messages_count from %s', async (_label, body) => {
    server.use(...handlers(body));

    const { result } = renderHook(() => usePlaybackConversation({ projectId: PROJECT, conversationId: CONVERSATION }), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });
    expect(Array.isArray(result.current.conversation?.chat_history)).toBe(true);
    expect(result.current.conversation?.chat_history).toHaveLength(2);
    expect(result.current.conversation?.messages_count).toBe(2);
  });
});

describe('useLoadPlaybackMessages', () => {
  it.each(SHAPES)('loads a page of messages from %s', async (_label, body) => {
    server.use(...handlers(body));

    const { result } = renderHook(
      () => useLoadPlaybackMessages({ projectId: PROJECT, conversationId: CONVERSATION, participants: [] }),
      { wrapper },
    );

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.messages).toHaveLength(2);
  });
});
