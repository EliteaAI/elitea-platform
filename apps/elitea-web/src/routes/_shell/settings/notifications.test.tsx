/**
 * notifications.test.tsx — regression coverage for the three confirmed
 * adversarial-review findings on ROUTE-062 (cluster A11-api-model):
 *
 *  1. The list/bulk-action fetches must scope to `personal_project_id`, not
 *     the currently-selected team/workspace project.
 *  2. The list query must actually reach page > 0, a non-default page size,
 *     a non-default sort, and a search term — not just accept them as
 *     params (`useNotificationsList` already did; this route previously
 *     never supplied them).
 *  3. The bulk mark-toggle must send `is_seen:true` OR `is_seen:false`
 *     depending on whether the selection contains an unread row, not
 *     always `true`.
 *
 * Mounts `NotificationsPage` (exported for exactly this reason, mirroring
 * `tokens.tsx`'s `PersonalTokensPage`) through a MINIMAL, hand-built
 * `RouterProvider` tree — a bare root route + one child at
 * `/settings/notifications` — rather than the app's real generated
 * `routeTree.gen.ts`. This is deliberate, not a shortcut: the real tree
 * routes this path through `_shell/settings/settings-layout.tsx`, which
 * renders `shared/ui/settings/SettingsRedirect.tsx` as a sibling of the
 * tab `<Outlet/>`. That component's `shouldRedirect` computation
 * (`if (!tab) return true`) reads `useParams({ strict: false }).tab`, but
 * NONE of the explicit per-tab leaf routes (`notifications.tsx`,
 * `secrets.tsx`, `model-configuration.tsx`, …) declare a `$tab` param —
 * only the `$tab.tsx` catch-all does — so `tab` is `undefined` for every
 * one of them and `SettingsRedirect` fires a `replace: true` navigation
 * back to `/settings/model-configuration` shortly after ANY of them
 * mounts. Confirmed directly (see this fix's final report): mounting
 * `/settings/notifications` through the real `routeTree` and awaiting
 * `router.state.status === 'idle'` lands on `/settings/model-configuration`
 * with `/_shell/settings/notifications` never even appearing in
 * `router.state.matches`. `src/routes/__tests__/settingsLayout.test.tsx`'s
 * existing per-tab assertions don't observe this because `waitFor` resolves
 * on the FIRST passing check (the pre-redirect paint) and never polls again
 * — they are not proof the redirect doesn't happen, only that this specific
 * timing race isn't hit. `SettingsRedirect.tsx` is entirely outside this
 * cluster's file scope (owned by whichever unit built `settings-layout.tsx`
 * — A9, per the workspace's own unit map), so it is NOT touched here; this
 * doc comment plus the final report are the handoff. A minimal route tree
 * that never mounts `SettingsLayout`/`SettingsRedirect` at all is the
 * correct way to keep THIS unit's regression coverage independent of a bug
 * in a file this cluster may not edit.
 */
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext, RouterContext } from '@/app/router-context';
import { AppProviders } from '@/app/providers/AppProviders';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';
import { NotificationsPage } from './notifications';

const BASE = '/api/v2';
const LIST_PATH = `${BASE}/notifications/notifications/prompt_lib/:projectId`;

const rootRoute = createRootRoute();
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/notifications',
  component: NotificationsPage,
});
const testRouteTree = rootRoute.addChildren([notificationsRoute]);

function mountAt(auth: AuthContext) {
  const history = createMemoryHistory({ initialEntries: ['/settings/notifications'] });
  const router = createRouter({ routeTree: testRouteTree, history, context: { auth } satisfies RouterContext });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

function authWith(personalProjectId: string, selectedProjectId: string): AuthContext {
  return {
    getUser: () => ({ id: 'u1', personal_project_id: personalProjectId, permissions: [], publicPermissions: [] }),
    getSelectedProjectId: () => selectedProjectId,
  };
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('finding 1 — personal-project scoping', () => {
  it('fetches the list against personal_project_id, not the currently-selected project', async () => {
    const capturedUrls: string[] = [];
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({ rows: [], total: 0 });
      }),
    );

    mountAt(authWith('personal-42', 'selected-99'));

    await waitFor(() => expect(capturedUrls.length).toBeGreaterThan(0));
    expect(capturedUrls[0]).toContain('/notifications/notifications/prompt_lib/personal-42');
    expect(capturedUrls[0]).not.toContain('selected-99');
  });
});

describe('finding 2 — pagination, page size, sort and search are all reachable', () => {
  it('sends a real page/pageSize/sort/search on user interaction, not just page 0 defaults', async () => {
    const capturedUrls: string[] = [];
    server.use(
      http.get(LIST_PATH, ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({
          rows: [{ id: 1, event_type: 'chat_user_added', created_at: '2026-01-01T00:00:00Z', is_seen: true }],
          total: 40,
        });
      }),
    );

    mountAt(authWith('personal-1', 'other-project'));

    await waitFor(() => expect(capturedUrls.length).toBeGreaterThan(0));
    const initial = new URL(capturedUrls[0]!);
    expect(initial.searchParams.get('offset')).toBe('0');
    expect(initial.searchParams.get('limit')).toBe('20');
    expect(initial.searchParams.get('sort_by')).toBe('created_at');
    expect(initial.searchParams.get('sort_order')).toBe('desc');

    const user = userEvent.setup();

    // Pagination past page 0.
    await user.click(await screen.findByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(new URL(capturedUrls.at(-1)!).searchParams.get('offset')).toBe('20');
    });

    // A non-default page size.
    const pageSizeCombobox = screen.getAllByRole('combobox').at(-1)!;
    await user.click(pageSizeCombobox);
    await user.click(await screen.findByRole('option', { name: '50' }));
    await waitFor(() => {
      const last = new URL(capturedUrls.at(-1)!);
      expect(last.searchParams.get('limit')).toBe('50');
      expect(last.searchParams.get('offset')).toBe('0');
    });

    // Sorting.
    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(await screen.findByRole('option', { name: 'Type (A–Z)' }));
    await waitFor(() => {
      const last = new URL(capturedUrls.at(-1)!);
      expect(last.searchParams.get('sort_by')).toBe('event_type');
      expect(last.searchParams.get('sort_order')).toBe('asc');
    });

    // Search.
    await user.type(screen.getByRole('textbox', { name: /search/i }), 'billing');
    await waitFor(
      () => {
        expect(new URL(capturedUrls.at(-1)!).searchParams.get('search')).toBe('billing');
      },
      { timeout: 3000 },
    );
  }, 15000);
});

describe('finding 3 — bulk mark-toggle sends the correct isSeen', () => {
  it('sends isSeen:true when the selection contains an unread row, and labels the button "Mark read"', async () => {
    const capturedBodies: unknown[] = [];
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({
          rows: [
            { id: 1, event_type: 'chat_user_added', created_at: '2026-01-01T00:00:00Z', is_seen: false },
            { id: 2, event_type: 'chat_user_added', created_at: '2026-01-02T00:00:00Z', is_seen: true },
          ],
          total: 2,
        }),
      ),
      http.put(LIST_PATH, async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );

    mountAt(authWith('personal-1', 'other-project'));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select all' }));
    const markButton = await screen.findByRole('button', { name: 'Mark read' });
    await user.click(markButton);

    await waitFor(() => expect(capturedBodies).toHaveLength(1));
    expect(capturedBodies[0]).toMatchObject({ is_seen: true, ids: ['1', '2'] });
  });

  it('sends isSeen:false when every selected row is already read, and labels the button "Mark unread"', async () => {
    const capturedBodies: unknown[] = [];
    server.use(
      http.get(LIST_PATH, () =>
        HttpResponse.json({
          rows: [
            { id: 1, event_type: 'chat_user_added', created_at: '2026-01-01T00:00:00Z', is_seen: true },
            { id: 2, event_type: 'chat_user_added', created_at: '2026-01-02T00:00:00Z', is_seen: true },
          ],
          total: 2,
        }),
      ),
      http.put(LIST_PATH, async ({ request }) => {
        capturedBodies.push(await request.json());
        return HttpResponse.json({});
      }),
    );

    mountAt(authWith('personal-1', 'other-project'));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Select all' }));
    const markButton = await screen.findByRole('button', { name: 'Mark unread' });
    await user.click(markButton);

    await waitFor(() => expect(capturedBodies).toHaveLength(1));
    expect(capturedBodies[0]).toMatchObject({ is_seen: false, ids: ['1', '2'] });
  });
});
