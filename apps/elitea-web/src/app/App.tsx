import { RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getConfig, MissingEnvPage } from '@/shared/config';
import { configureGeneratedClient } from '@/shared/api/generated/mutator';

import { AppProviders } from './providers';
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
  configureGeneratedClient({ baseUrl: config.config.vite_server_url });

  return (
    <AppProviders>
      <RouterProvider router={router} context={{ auth: sessionAuthContext }} />
    </AppProviders>
  );
}
