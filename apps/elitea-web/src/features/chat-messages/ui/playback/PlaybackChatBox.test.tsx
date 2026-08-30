/**
 * The playback box rendered inline placeholder `<Box>`es where the transcript
 * belongs — a div with the raw `content` string in it and nothing else: no
 * author, no avatar, no attachments, no markdown, no per-row testid. It
 * LOOKED like a transcript in a screenshot, which is why nothing caught it.
 *
 * These cases pin the real `ChatMessageList` (`chat-message-list` /
 * `chat-message-item`), and the two-spelling adapter that feeds it.
 */
import type { ReactElement, ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { server } from '@/test/setup';

import { PlaybackChatBox, toChatMessage } from './PlaybackChatBox';

const BASE = '/api/v2';
const PROJECT = '9';
const CONVERSATION = '3';

const CONVERSATION_WIRE = {
  id: CONVERSATION,
  name: 'Replay',
  participants: [],
  messages_count: 2,
  chat_history: [
    { id: 'm1', role: 'user', name: 'Ada', content: 'What is the plan?', created_at: 1_760_000_000_000 },
    { id: 'm2', role: 'assistant', name: 'Agent', content: 'Here is the plan.', created_at: 1_760_000_001_000 },
  ],
};

function wrap(ui: ReactNode): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  // jsdom implements no scrollIntoView; the box auto-scrolls on every list
  // change. Same stub `ChatMessageList.test.tsx` installs for the same reason.
  Element.prototype.scrollIntoView = vi.fn();
  configureGeneratedClient({ baseUrl: BASE });
  server.use(
    http.get(`${BASE}/elitea_core/messages/prompt_lib/${PROJECT}/${CONVERSATION}`, () =>
      HttpResponse.json({ items: [], total: 0, page: 1, page_size: 10, total_pages: 1 }),
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('toChatMessage', () => {
  it('reads the WIRE spelling (message_items / created_at)', () => {
    const result = toChatMessage(
      { id: 7, role: 'user', content: 'hi', message_items: [{ item_type: 'attachment_message' }], created_at: 1_760_000_000_000 },
      0,
    );
    expect(result.id).toBe('7');
    expect(result.content).toBe('hi');
    expect(result.messageItems).toHaveLength(1);
    expect(result.createdAt).toBe(new Date(1_760_000_000_000).toISOString());
  });

  /*
   * `useLoadPlaybackMessages` returns rows ALREADY through
   * `convertMessagesToChatHistory`, and this component splices them into the
   * same array as the raw wire rows. Reading one spelling silently drops the
   * other kind's attachments and timestamp.
   */
  it('reads the CONVERTED spelling (messageItems / createdAt) too', () => {
    const result = toChatMessage(
      { id: 'x', role: 'assistant', content: 'yo', messageItems: [{ a: 1 }], createdAt: '2026-08-01T10:00:00.000Z' } as never,
      0,
    );
    expect(result.messageItems).toHaveLength(1);
    expect(result.createdAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('gives an id-less row a stable synthetic id rather than undefined', () => {
    expect(toChatMessage({ role: 'user', content: 'x' }, 4).id).toBe('playback-4');
  });
});

describe('PlaybackChatBox', () => {
  it('renders the real ChatMessageList, not an inline placeholder', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      wrap(
        <PlaybackChatBox
          conversation={CONVERSATION_WIRE as never}
          projectId={PROJECT}
        />,
      ),
    );

    // Before any step, the window is empty and the list renders playback's own
    // empty copy — NOT its "No messages yet" default, which would claim an
    // un-started replay has no transcript.
    expect(screen.getByTestId('playback-empty-state')).toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();

    // Two steps forward reveal the user question as a real message row.
    await user.click(screen.getByLabelText('Forward'));
    await user.click(screen.getByLabelText('Forward'));

    await waitFor(() => {
      expect(screen.getAllByTestId('chat-message-item').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('chat-message-list')).toBeInTheDocument();
    expect(screen.getByText('What is the plan?')).toBeInTheDocument();
  });
});
