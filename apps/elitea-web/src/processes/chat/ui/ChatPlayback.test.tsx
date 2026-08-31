/**
 * The mount point itself. `PlaybackChatBox` was fully built and rendered by
 * nothing, so swapping its internals for the real message list would have
 * shipped a screen no user could open. These cases assert the surface
 * actually renders, and that its two non-happy paths say something.
 */
import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';
import { useSelectedProjectStore } from '@/widgets/app-shell';

import { ChatPlayback } from './ChatPlayback';

const BASE = '/api/v2';
const PROJECT = '7';
const CONVERSATION = 'c-1';

function wrap(ui: ReactNode): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  configureGeneratedClient({ baseUrl: BASE });
  useSelectedProjectStore.setState({ project: { id: PROJECT, name: 'Project 7' } });
  server.use(
    http.get(`${BASE}/elitea_core/messages/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, page_size: 10, total_pages: 1 }),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('ChatPlayback', () => {
  it('renders the playback box for the named conversation', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/conversation/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
        // Flat, not `{data:…}`: the generated mutator already wraps the body
        // in the envelope `conversationDetails` unwraps (see
        // `playbackMessageShapes.test.tsx`, which mocks the same route).
        HttpResponse.json({
          id: CONVERSATION,
          name: 'Yesterday’s run',
          participants: [],
          messages_count: 1,
          chat_history: [{ id: 'm1', role: 'user', content: 'Replay me', created_at: 1_760_000_000_000 }],
        }),
      ),
    );

    renderWithTheme(wrap(<ChatPlayback conversationId={CONVERSATION} />));

    expect(await screen.findByText('Yesterday’s run')).toBeInTheDocument();
    // The toolbar is the playback box's own chrome — its presence is what
    // proves the box, not just the wrapper, rendered.
    expect(screen.getByLabelText('Forward')).toBeInTheDocument();
  });

  it('says so when the conversation cannot be loaded, instead of rendering an empty replay', async () => {
    server.use(
      http.get(`${BASE}/elitea_core/conversation/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );

    renderWithTheme(wrap(<ChatPlayback conversationId={CONVERSATION} />));

    await waitFor(() => {
      expect(screen.getByTestId('chat-playback')).toHaveTextContent('could not be loaded');
    });
  });
});
