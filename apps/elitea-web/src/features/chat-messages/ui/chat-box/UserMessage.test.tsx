/**
 * Who a reloaded question is attributed to.
 *
 * `GET /elitea_core/messages/prompt_lib/{project}/{conversation}` answers rows
 * with no author field, so `entities/message`'s normaliser leaves `name` empty
 * (see its own tests) and this component is what decides the caption. Without
 * these cases the substitution would be unobservable wiring: the normaliser
 * change alone turns the wrong caption into NO caption, which reads as fixed
 * on a screenshot and is not.
 *
 * `useGetCurrentAuthor` is substituted at the network boundary (MSW) per R-M1
 * — no `vi.mock` — with the same `QueryClientProvider` + generated-client
 * wiring `ExpandedParticipants/ParticipantItemRow.test.tsx` established.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../../test/setup';

import type { ChatMessage } from '../../lib/convertMessagesToChatHistory';
import { UserMessage } from './UserMessage';

const BASE = '/api/v2';
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

afterEach(() => {
  resetGeneratedClient();
});

/** Answers the one query this row makes (`useGetCurrentAuthor`). */
function stubCurrentAuthor(profile: Record<string, unknown>): void {
  configureGeneratedClient({ baseUrl: BASE });
  server.use(http.get(`${BASE}/social/author`, () => HttpResponse.json(profile)));
}

function renderMessage(message: Partial<ChatMessage>): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
        <UserMessage
          message={{ id: 'q1', role: 'user', name: '', content: 'hello', createdAt: '2026-08-29T10:00:00Z', ...message }}
          messageId="q1"
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('UserMessage author caption', () => {
  it('attributes an author-less persisted question to the signed-in user', async () => {
    stubCurrentAuthor({ id: 'me', name: 'E2E Chat Driver', email: 'driver@example.com' });
    renderMessage({ name: '' });

    await waitFor(() => {
      expect(screen.getByText('E2E Chat Driver')).toBeTruthy();
    });
  });

  it('falls back to the signed-in email when the profile carries a blank name', async () => {
    stubCurrentAuthor({ id: 'me', name: '   ', email: 'driver@example.com' });
    renderMessage({ name: '' });

    await waitFor(() => {
      expect(screen.getByText('driver@example.com')).toBeTruthy();
    });
  });

  it('keeps a genuinely departed author as such, rather than re-attributing it to the reader', async () => {
    stubCurrentAuthor({ id: 'me', name: 'E2E Chat Driver', email: 'driver@example.com' });
    renderMessage({ name: 'User No Longer Available' });

    await waitFor(() => {
      expect(screen.getByText('User No Longer Available')).toBeTruthy();
    });
    expect(screen.queryByText('E2E Chat Driver')).toBeNull();
  });

  it('never re-attributes a message that names an author the reader is not', async () => {
    stubCurrentAuthor({ id: 'me', name: 'E2E Chat Driver', email: 'driver@example.com' });
    renderMessage({ name: '', userId: 'someone-else' });

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeTruthy();
    });
    expect(screen.queryByText('E2E Chat Driver')).toBeNull();
  });

  it('renders no caption at all while the profile has not landed', () => {
    stubCurrentAuthor({ id: 'me', name: 'E2E Chat Driver', email: 'driver@example.com' });
    renderMessage({ name: '' });

    // Synchronous first paint, before the query resolves: an empty caption is
    // the correct intermediate state, not the string "undefined".
    expect(screen.queryByText('E2E Chat Driver')).toBeNull();
    expect(screen.queryByText('undefined')).toBeNull();
  });
});
