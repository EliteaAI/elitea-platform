/**
 * `/shared/chat/:token` — the anonymous page, mounted through the REAL router
 * against a REAL MSW boundary (mocks stop at the network, §6.2).
 *
 * The assertions that matter here are the refusals, and one of them is about
 * something the page must NOT do: the 401 that means "password required" must
 * not be escalated into a re-auth popup. That escalation is the default
 * behaviour of the app's shared HTTP client, so the test that the page shows an
 * unlock prompt at all is simultaneously the test that it is not using it.
 */
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubAuthContext } from '@/app/router-context';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { resetConfigForTests } from '@/shared/config/get-config';
import { server } from '@/test/setup';

import { routeTree } from '../routeTree.gen';

const VIEW = '*/elitea_core/shared_chat_view/prompt_lib/:token';
const UNLOCK = '*/elitea_core/shared_chat_view_unlock/prompt_lib/:token/unlock';

// The real app wraps `RouterProvider` in the Elitea `ThemeProvider`
// (`app/main.tsx`), so this mirrors production rather than rendering the route
// under MUI's bare default theme — several `shared/ui` components read
// `theme.vars.palette.*` and throw without it.
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function mountAt(path: string): void {
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({ routeTree, history, context: { auth: stubAuthContext } });
  render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  resetConfigForTests();
  vi.stubEnv('VITE_SERVER_URL', '/api/v2');
  vi.stubEnv('VITE_BASE_URI', '/app/');
  vi.stubEnv('VITE_PUBLIC_PROJECT_ID', '11');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetConfigForTests();
});

describe('/shared/chat/:token', () => {
  it('renders the transcript a valid token resolves to', async () => {
    server.use(
      http.get(VIEW, () =>
        HttpResponse.json({
          conversation_name: 'Quarterly plan',
          expires_at: '2030-01-01T00:00:00Z',
          messages: [
            { id: 0, author_type: 'user', author_name: 'Ada', created_at: '2026-01-01T10:00:00Z', is_error: false, items: [{ type: 'text_message', content: 'hello there' }] },
            { id: 1, author_type: 'assistant', author_name: 'Planner', created_at: '2026-01-01T10:00:05Z', is_error: false, items: [{ type: 'text_message', content: 'hi back' }] },
          ],
        }),
      ),
    );

    mountAt('/shared/chat/tok-123');

    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation')).toBeInTheDocument();
    });
    expect(screen.getByText('Quarterly plan')).toBeInTheDocument();
    expect(screen.getAllByTestId('shared-conversation-message')).toHaveLength(2);
  });

  it('names an attachment without offering a download', async () => {
    server.use(
      http.get(VIEW, () =>
        HttpResponse.json({
          conversation_name: 'With a file',
          expires_at: '2030-01-01T00:00:00Z',
          messages: [{ id: 0, author_type: 'user', created_at: '2026-01-01T10:00:00Z', is_error: false, items: [{ type: 'attachment_message', attachment: { name: 'report.pdf', attachment_type: 'file' } }] }],
        }),
      ),
    );

    mountAt('/shared/chat/tok-123');

    const attachment = await screen.findByTestId('shared-conversation-attachment');
    expect(attachment).toHaveTextContent('report.pdf');
    // No anonymous byte route exists, so an <a href> here would be a dead
    // link pointing at storage the server refuses to serve.
    expect(attachment.querySelector('a')).toBeNull();
  });

  // ---- the refusals -----------------------------------------------------

  it('shows one "not available" state for a token the server refuses (404)', async () => {
    server.use(http.get(VIEW, () => HttpResponse.json({ error: 'shared conversation not found' }, { status: 404 })));

    mountAt('/shared/chat/wrong-token');

    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-unavailable')).toBeInTheDocument();
    });
    // The server does not tell this page whether the token was unknown,
    // revoked or expired, and the page must not claim to know: no wording
    // that would let a reader distinguish the three.
    const text = screen.getByTestId('shared-conversation-unavailable').textContent ?? '';
    expect(text).not.toMatch(/revoked by|expired on|no such/i);
  });

  it('asks for a password on a 401 instead of escalating to re-auth', async () => {
    server.use(http.get(VIEW, () => HttpResponse.json({ password_required: true }, { status: 401 })));

    mountAt('/shared/chat/locked-token');

    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation-locked')).toBeInTheDocument();
    });
    // If the page were on the app's re-auth client, the 401 would have been
    // burned on a login popup and this prompt would never render.
    expect(screen.getByTestId('shared-conversation-password')).toBeInTheDocument();
  });

  it('reports a rejected password without saying whether the link exists', async () => {
    server.use(
      http.get(VIEW, () => HttpResponse.json({ password_required: true }, { status: 401 })),
      http.post(UNLOCK, () => HttpResponse.json({ error: 'incorrect password' }, { status: 403 })),
    );

    mountAt('/shared/chat/locked-token');
    await screen.findByTestId('shared-conversation-locked');

    await userEvent.type(screen.getByTestId('shared-conversation-password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    const error = await screen.findByTestId('shared-conversation-unlock-error');
    expect(error.textContent ?? '').not.toMatch(/not found|no such link|does not exist/i);
  });

  it('re-reads the conversation after a successful unlock', async () => {
    let unlocked = false;
    server.use(
      http.get(VIEW, () => {
        if (!unlocked) return HttpResponse.json({ password_required: true }, { status: 401 });
        return HttpResponse.json({ conversation_name: 'Unlocked', expires_at: '2030-01-01T00:00:00Z', messages: [] });
      }),
      http.post(UNLOCK, () => {
        unlocked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    mountAt('/shared/chat/locked-token');
    await screen.findByTestId('shared-conversation-locked');

    await userEvent.type(screen.getByTestId('shared-conversation-password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByTestId('shared-conversation')).toBeInTheDocument();
    });
    expect(screen.getByText('Unlocked')).toBeInTheDocument();
  });

  it('does not render app chrome — the visitor has no session and no project', async () => {
    server.use(http.get(VIEW, () => HttpResponse.json({ conversation_name: 'Bare', expires_at: '2030-01-01T00:00:00Z', messages: [] })));

    mountAt('/shared/chat/tok-123');

    await screen.findByTestId('shared-conversation');
    // The shell's navigation rail is the discriminator: if this route were
    // nested under `_shell`, it would be here.
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
