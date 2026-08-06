/**
 * NotificationButton.test.tsx — regression coverage for SHELL-013 (the
 * header-bell notification popover, unit "notification-button-composition-
 * gap"). Mounts `NotificationButton` through a minimal hand-built
 * `RouterProvider` tree (same technique as `routes/_shell/settings/
 * notifications.test.tsx` and `features/agents/api/useSelectedProjectId.
 * test.tsx`) plus a real `QueryClientProvider` (`features/notifications/ui/
 * NotificationListItem.test.tsx`'s own pattern) — no `@/app` import
 * anywhere, matching every other `widgets/sidebar/__tests__` file's
 * convention of staying below the `app/` layer even in tests.
 */
import type { ReactElement } from 'react';

import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { installTestEventSource, type TestEventSourceRegistry } from '@/shared/api/sse/testing';
import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { resetConfigForTests } from '@/shared/config/get-config';

import { server } from '../../../test/setup';
import { NotificationButton } from '../ui/NotificationButton';

const BASE = '/api/v2';
const LIST_PATH = `${BASE}/notifications/notifications/prompt_lib/:projectId`;
const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);
const globals = globalThis as unknown as Record<string, unknown>;

interface RenderOptions {
  readonly personalProjectId?: string;
}

async function renderNotificationButton(options: RenderOptions = {}): Promise<AnyRouter> {
  const { personalProjectId } = options;
  const auth = {
    getUser: () => (personalProjectId === undefined ? undefined : { personal_project_id: personalProjectId }),
    getSelectedProjectId: () => undefined,
  };

  const rootRoute = createRootRoute();
  const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <NotificationButton /> as ReactElement });
  const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: () => <div>chat-page</div> });
  const notificationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/notifications',
    component: () => <div>notifications-page</div>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, chatRoute, notificationsRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth },
  });
  await router.load();

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return router;
}

/**
 * `meta: {}` (not omitted) matters: `LegacyNotificationMessage.tsx`
 * deliberately renders `null` when `meta === undefined` (its own doc
 * comment — a genuinely absent `meta` is treated as "nothing to render",
 * §3.6). Real API rows always carry a `meta` object; matching that here
 * (rather than the wire's field simply being absent) is what makes
 * `private_project_created`'s message text actually render, same as
 * `NotificationListItem.test.tsx`'s own manually-built fixtures.
 */
function wireNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    event_type: 'private_project_created',
    created_at: '2026-01-01T00:00:00Z',
    is_seen: false,
    meta: {},
    ...overrides,
  };
}

let sse: TestEventSourceRegistry;

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
  // The live-push half is SSE now (issue #92): jsdom implements no
  // `EventSource`, so the double from `shared/api/sse/testing.ts` stands in
  // — and the runtime config has to actually resolve, since the hook builds
  // its stream URL from `vite_server_url`.
  sse = installTestEventSource();
  globals['elitea_ui_config'] = { vite_server_url: BASE, vite_base_uri: '/', vite_public_project_id: 'public-1' };
  resetConfigForTests();
});

afterEach(() => {
  resetGeneratedClient();
  sse.restore();
  delete globals['elitea_ui_config'];
  resetConfigForTests();
});

describe('NotificationButton — trigger + unread badge', () => {
  it('always renders the bell button, even before the badge query resolves', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 0 })));
    await renderNotificationButton({ personalProjectId: '7' });
    expect(screen.getByTestId('sidebar-notification-button')).toBeInTheDocument();
  });

  it('shows no unread dot when the on-mount badge query returns total: 0', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 0 })));
    await renderNotificationButton({ personalProjectId: '7' });
    await waitFor(() => expect(screen.queryByTestId('sidebar-notification-unread-dot')).toBeNull());
  });

  it('shows the unread dot once the on-mount badge query returns a positive total', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 3 })));
    await renderNotificationButton({ personalProjectId: '7' });
    expect(await screen.findByTestId('sidebar-notification-unread-dot')).toBeInTheDocument();
  });

  it('subscribes to the project-scoped SSE notifications stream on mount', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 0 })));
    await renderNotificationButton({ personalProjectId: '7' });
    expect(sse.getSources().map((source) => source.url)).toEqual([`${BASE}/notifications/events/prompt_lib/7`]);
  });

  it('flips the badge on immediately via a live "notifications_notify" SSE push', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 0 })));
    await renderNotificationButton({ personalProjectId: '7' });
    // Let the on-mount badge query genuinely SETTLE before firing the push
    // — `total: 0` renders identically to the component's own pre-settle
    // initial state, so asserting "no dot" alone (without first flushing
    // the query's own pending promise chain) proves nothing about whether
    // the query has actually resolved yet; a push fired before it settles
    // would legitimately race against that query's own (also `total: 0`)
    // response landing right after it, same as production (`data`'s
    // effect is always authoritative — see `NotificationButton.tsx`).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(screen.queryByTestId('sidebar-notification-unread-dot')).toBeNull());
    act(() => {
      sse.emit('notifications_notify');
    });
    expect(await screen.findByTestId('sidebar-notification-unread-dot')).toBeInTheDocument();
  });

  /**
   * `notifications_ready` is the stream's "the durable list is ahead of
   * your cache" signal (the opening cursor handshake, and the substitute
   * the Go route sends for an oversized notification). It carries no
   * payload the UI can render, so its whole job is to invalidate the
   * notifications queries and let the authoritative refetch speak.
   */
  it('refetches the badge query on a "notifications_ready" SSE push', async () => {
    let total = 0;
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total })));
    await renderNotificationButton({ personalProjectId: '7' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(screen.queryByTestId('sidebar-notification-unread-dot')).toBeNull());

    total = 3;
    act(() => {
      sse.emit('notifications_ready');
    });
    expect(await screen.findByTestId('sidebar-notification-unread-dot')).toBeInTheDocument();
  });

  it('opens no stream and still renders when there is no personal project to scope it to', async () => {
    const router = await renderNotificationButton({});
    expect(sse.getSources()).toHaveLength(0);
    expect(screen.getByTestId('sidebar-notification-button')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('degrades gracefully in a runtime with no EventSource (no crash, badge still driven by the query)', async () => {
    sse.restore();
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 1 })));
    await renderNotificationButton({ personalProjectId: '7' });
    expect(await screen.findByTestId('sidebar-notification-unread-dot')).toBeInTheDocument();
  });

  /**
   * R2 regression: a live push must not permanently ratchet the dot "on".
   * The old app recomputes `hasMessages` from EVERY fresh query response
   * (`NotificationButton.jsx:60-64`) — a live push only sets it `true`
   * optimistically in between. Reproduces the real-world trigger: a push
   * arrives, then "Mark all as read" invalidates + refetches the same
   * badge query, which reports `total: 0` again — the dot must clear.
   */
  it('clears the unread dot once a fresh query response reports total: 0, even after a live push set it optimistically (no one-way ratchet)', async () => {
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        const limit = new URL(request.url).searchParams.get('limit');
        // Badge query (pageSize: 1) always reports 0 unread; popover query
        // (pageSize: 5) returns one unseen row so "Mark all as read" is
        // enabled and its mutation has something to invalidate/refetch.
        if (limit === '1') return HttpResponse.json({ rows: [], total: 0 });
        return HttpResponse.json({ rows: [wireNotification({ id: 1, is_seen: false })], total: 1 });
      }),
    );
    server.use(http.put(LIST_PATH, () => HttpResponse.json({})));

    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });

    // Let the on-mount badge query genuinely settle first (see the "flips
    // the badge on immediately" test above for why this matters).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await waitFor(() => expect(screen.queryByTestId('sidebar-notification-unread-dot')).toBeNull());

    act(() => {
      sse.emit('notifications_notify');
    });
    expect(await screen.findByTestId('sidebar-notification-unread-dot')).toBeInTheDocument();

    await user.click(screen.getByTestId('sidebar-notification-button'));
    const markAllButton = await screen.findByText('Mark all as read');
    await user.click(markAllButton);

    await waitFor(() => expect(screen.queryByTestId('sidebar-notification-unread-dot')).toBeNull());
  });
});

describe('NotificationButton — no personal project (graceful fallback)', () => {
  it('navigates to /chat instead of opening the popover when personal_project_id is unavailable', async () => {
    const user = userEvent.setup();
    const router = await renderNotificationButton({});
    await user.click(screen.getByTestId('sidebar-notification-button'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    expect(screen.queryByText('Mark all as read')).toBeNull();
  });
});

describe('NotificationButton — popover', () => {
  it('opens on click, showing up to POPOVER_PAGE_SIZE most-recent-unread rows via NotificationListItem', async () => {
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({ rows: [wireNotification({ id: 1 }), wireNotification({ id: 2, is_seen: true })], total: 2 }),
      ),
    );
    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    expect(await screen.findAllByText('Project was successfully created.')).toHaveLength(2);
    expect(screen.getByText('Mark all as read')).toBeInTheDocument();
    expect(screen.getByText('View all')).toBeInTheDocument();
  });

  it('shows an empty state when there are no unread notifications', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [], total: 0 })));
    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    expect(await screen.findByText('No new notifications right now')).toBeInTheDocument();
    expect(screen.queryByText('Mark all as read')).toBeNull();
  });

  it('"Mark all as read" fires the bulk-mark-seen mutation with ids: "all"', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [wireNotification()], total: 1 })));
    let sentBody: unknown;
    server.use(
      http.put(LIST_PATH, async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({});
      }),
    );
    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    const markAllButton = await screen.findByText('Mark all as read');
    await user.click(markAllButton);
    await waitFor(() => expect(sentBody).toEqual({ ids: 'all', is_seen: true }));
  });

  it('disables "Mark all as read" when every visible row is already seen', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [wireNotification({ is_seen: true })], total: 1 })));
    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    expect(await screen.findByText('Mark all as read')).toBeDisabled();
  });

  it('"View all" navigates to /settings/notifications and closes the popover', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [wireNotification()], total: 1 })));
    const user = userEvent.setup();
    const router = await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    const viewAllButton = await screen.findByText('View all');
    await user.click(viewAllButton);
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/notifications'));
    await waitFor(() => expect(screen.queryByText('View all')).toBeNull());
  });

  it('the close button in the popover header closes it', async () => {
    server.use(http.get(LIST_PATH, () => HttpResponse.json({ rows: [wireNotification()], total: 1 })));
    const user = userEvent.setup();
    await renderNotificationButton({ personalProjectId: '7' });
    await user.click(screen.getByTestId('sidebar-notification-button'));
    await screen.findByText('Notifications');
    await user.click(screen.getByRole('button', { name: 'Close notifications' }));
    await waitFor(() => expect(screen.queryByText('View all')).toBeNull());
  });
});
