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
import { createRootRouteWithContext, Outlet, stripSearchParams } from '@tanstack/react-router';
import type { AnySchema } from '@tanstack/react-router';

import type { RouterContext } from '@/app/router-context';

import { PARAM_DEFAULTS } from './-search/params';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  /**
   * Keeps defaulted query parameters OUT of the address bar.
   *
   * DEFECT: every schema in `-search/params.ts` ends in `.prefault(default)`,
   * so `validateSearch` returns every declared key on every call. TanStack
   * Router runs `validateSearch` inside `buildLocation` with
   * `_includeValidateSearch: true`, so all of those defaults were serialised
   * back into the URL. A click on any in-app link to `/chat` produced a
   * 359-character URL with 29 empty or defaulted parameters. Every "strip the
   * flag from the URL after use" cleanup also wrote the key straight back as
   * an empty value.
   *
   * ONE middleware, on the ROOT route, covers the whole tree. The chain that
   * `buildMiddlewareChain` assembles runs root first. Each middleware
   * post-processes the result of `next()`, which is the whole downstream
   * chain, every descendant route's own `validateSearch` included. So a
   * key declared only by a leaf route is stripped here too. Read that before
   * adding a second copy of this middleware to a leaf route: it is not
   * needed, and a second copy would drift.
   *
   * The map is derived from the schemas themselves, so it cannot disagree
   * with a `prefault` value. See `PARAM_DEFAULTS`.
   *
   * This changes the emitted URL only. `useSearch()` readers still get the
   * full defaulted object, because the committed match's search comes from
   * parsing the real URL through `validateSearch`.
   *
   * The generic is named because this route declares no `validateSearch` of
   * its own, so inference has nothing to work from and lands on `unknown`.
   * `AnySchema` is the schema type the root route options expect.
   */
  search: { middlewares: [stripSearchParams<AnySchema>(PARAM_DEFAULTS)] },
});

function RootComponent() {
  return <Outlet />;
}
