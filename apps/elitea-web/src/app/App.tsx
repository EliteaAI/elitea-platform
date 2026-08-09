import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getConfig, MissingEnvPage } from '@/shared/config';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';
import { createAuthPopupController } from '@/shared/api/auth';

import { AppProviders, getAppBasename } from './providers';
import { createAppRouter } from './router';
import { sessionAuthContext, useSessionStore } from './session-store';

/**
 * App shell (spec §9.3 units F1/F3/R1/R2).
 *
 * Unit F3 wired the runtime-config gate: when any of the three required
 * config vars is missing or invalid, the shell renders MissingEnvPage
 * instead of the app — parity with old App.jsx:11 (MISSING_ENVS.length > 0
 * ? <EnvMissingPage/> : <RouterProvider/>). Unit R1 wires the TanStack
 * Router `RouterProvider` in on the non-missing branch, preserving that
 * exact gate: the router (and therefore every `beforeLoad` guard) never
 * mounts while required config is absent, matching the old app's ordering
 * exactly (`App.jsx:11` gates BEFORE `<RouterProvider>` construction). Unit
 * R2 preserves this gate unchanged: `MissingEnvPage` still returns BEFORE
 * `AppProviders` — and therefore before theme/i18n/query-client/error
 * boundary — ever mounts.
 *
 * `router` is created once per mount via `useState`'s lazy initializer
 * (not module scope — R-S2 discipline extends to router construction the
 * same way it does to zustand stores: no shared mutable singleton created
 * at import time in a file `app/` also imports).
 *
 * R2 INTEGRATION NOTE (read together with `./router.tsx` and
 * `../routes/__root.tsx`'s headers, both unit R1's files): R1's root route
 * documents wrapping `<Outlet/>` in `Providers` INSIDE `__root.tsx` as one
 * possible integration shape, but `src/routes/**` is R1's exclusive Wave-1
 * ownership (concurrent unit; not this unit's path to edit). `AppProviders`
 * is wired here instead, one level further out, around `<RouterProvider>`
 * itself. This is equivalent in coverage — everything the router renders,
 * including `router.tsx`'s `defaultPendingComponent`/`defaultErrorComponent`
 * (`RoutePending`/`RouteError`) and every route's own component, is a
 * descendant of `<RouterProvider>` and therefore of `AppProviders` — and it
 * needs no change to any file under `src/routes/**` or `src/app/router*`.
 *
 * NOT done here, and flagged rather than silently skipped: `router.tsx`'s
 * `createAppRouter()` does not yet call `basename` on `createRouter()` (spec
 * §7.1 C3), and `<RouterProvider>` below does not override the router's
 * stub `context.auth` (`./router-context.ts`) with a real session-backed
 * one. Both are real integration gaps this unit's task list (QueryClient /
 * ThemeProvider / I18nProvider / error boundary / exposing `getAppBasename`
 * / composing `AppProviders`) does not cover, and both require editing
 * `src/app/router.tsx`, which this unit does not own. `getAppBasename()`
 * (`./providers`) is ready for whoever makes that edit.
 */
export function App() {
  const config = getConfig();
  const [router] = useState(() => createAppRouter());
  const fetchSession = useSessionStore((state) => state.fetchSession);
  /**
   * ONE controller for the whole app lifetime (issue #136 B). A controller
   * created per render would defeat its single-flight slot — `flight` is
   * closure state — so it is built once by a lazy `useState` initializer,
   * the same R-S2 shape `router` above uses. Created before the config gate
   * below because hooks must be unconditional; construction itself touches
   * neither config nor the DOM.
   *
   * `basePath` is trimmed of the trailing slash `VITE_BASE_URI` carries
   * (`/app/`), because the callback path it is concatenated with already
   * starts with one — `/app//auth-callback` is a different URL and would not
   * match ROUTE-001.
   */
  const [authPopup] = useState(() =>
    createAuthPopupController({ basePath: getAppBasename().replace(/\/$/, '') }),
  );

  useEffect(() => {
    void fetchSession().then(() => {
      // Re-run all active beforeLoad guards now that the session is known.
      void router.invalidate();
    });
  }, [fetchSession, router]);

  if (config.status === 'missing') {
    return <MissingEnvPage missing={config.missing} />;
  }

  // Wire the generated API client with the runtime server URL (R2 gap).
  // Called on every render, but idempotent — configureGeneratedClient replaces
  // the singleton in-place, which is fine since the URL never changes at runtime.
  //
  // `reauthenticate` is what makes §5.4 behaviour 2/3 live: without it
  // `http.ts`'s `runReauth()` returns false before doing anything, so
  // `needsReauth()` was dead for every 401/403 in the app and
  // `createAuthPopupController` had no production call site at all (issue
  // #136 B). Passing the CONTROLLER's method (not a fresh flight per client)
  // keeps single-flight intact across the re-configurations this render-time
  // call performs.
  configureGeneratedClient({
    baseUrl: config.config.vite_server_url,
    // Called through the controller rather than passed as a bare method
    // reference: the flight slot is closure state on that one object, so it
    // must stay the receiver (and `typescript(unbound-method)` says so too).
    reauthenticate: () => authPopup.reauthenticate(),
  });

  return (
    <AppProviders>
      <RouterProvider router={router} context={{ auth: sessionAuthContext }} />
    </AppProviders>
  );
}
