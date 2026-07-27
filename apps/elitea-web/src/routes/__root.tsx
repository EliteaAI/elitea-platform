/**
 * Root route (spec §2.3, §3.2, §9.3 unit R1). This is the single top-level
 * TanStack Router tree spec §3.2/P11 requires — replacing the old app's
 * broken two-level router (`router.jsx`'s outer `<Route path="/*"
 * element={<AppLayout/>}>` whose `AppLayout` has no `<Outlet/>`, so the
 * REAL routing happens in a disconnected descendant `<Routes>` inside
 * `MainPanel`; see P11/`AppLayout.jsx:18-23`). Everything here is one
 * coherent, Outlet-connected tree.
 *
 * ── R2 integration (landed) ──────────────────────────────────────────────
 * Spec §9.3 R2 owns `src/app/providers/**` (MUI + react-query + brand +
 * i18n + error boundary composition). It landed while this unit was still
 * in progress and wired itself in one level further OUT than this file's
 * original placeholder assumed: `app/App.tsx` wraps `<AppProviders>` around
 * `<RouterProvider router={router} />` directly, rather than this root
 * route wrapping `<Outlet/>` in it. Functionally equivalent — everything
 * the router renders (every route's component, `router.tsx`'s
 * `defaultPendingComponent`/`defaultErrorComponent`) is a descendant of
 * `<RouterProvider>` and therefore of `AppProviders` either way — and it
 * required no change to this file or any other file under `src/routes/**`.
 * See `app/App.tsx`'s own header for the full integration note (R2's).
 */
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import type { RouterContext } from '@/app/router-context';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  return <Outlet />;
}
