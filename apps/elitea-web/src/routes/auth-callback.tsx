/**
 * ROUTE-001 `/auth-callback` -> `AuthCallbackPage` (spec §8.1: "eager, not
 * lazy"; "**none** — no sidebar, no guard"; `?auth_state=` — PARAM-028/
 * spec QP-010). Top-level sibling of `_shell`, not nested under it — the
 * popup that lands here never shows app chrome.
 *
 * "Eager, not lazy" (old `router.jsx:4`, a static top-level import instead
 * of the `ChunkHelpers.lazyWithRetry` every other page uses) is reproduced
 * by simply NOT opting this route into TanStack Router's
 * `autoCodeSplitting` — see `router.tsx`'s `codeSplittingOptions` /
 * per-file `// @codeSplitGroup` convention note. `validateSearch` and the
 * route's own module are unconditionally part of the main chunk.
 *
 * Behaviour itself is unit F4's already-landed, tested contract
 * (`shared/api/auth/{callback,verify-session,http}` — see those modules'
 * headers: "consumed by the callback route (R1/R2)"). Wiring an already-
 * built unit's public API into the one route that exists to consume it is
 * routing-infrastructure work, not new business logic (task item 6 scopes
 * the "no business logic" rule to page CONTENT that Wave 2 owns — chat,
 * agents, settings, etc. — not to a unit's own documented integration
 * point).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { completeAuthCallback, createVerifySession } from '@/shared/api/auth';
import { createHttpClient } from '@/shared/api/http';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';

import { pickParams } from './-search/params';

export const Route = createFileRoute('/auth-callback')({
  validateSearch: pickParams('auth_state'),
  component: AuthCallbackPage,
});

type CallbackStatus = 'pending' | 'success' | 'error';

function AuthCallbackPage() {
  const [status, setStatus] = useState<CallbackStatus>('pending');
  // The route's OWN validated search, not `window.location.search`: the
  // latter is only meaningful with a real browser History and stays
  // disconnected from TanStack Router's state under `createMemoryHistory`
  // (used by every test in this unit, and by any embedder that mounts the
  // router off-DOM) — reading it directly silently drops `auth_state` in
  // exactly those contexts. `Route.useSearch()` reflects the router's
  // actual current location regardless of history implementation.
  const { auth_state: authState } = Route.useSearch();

  useEffect(() => {
    let cancelled = false;
    const config = getConfig();
    if (config.status !== 'ok') {
      setStatus('error');
      return;
    }
    // No `reauthenticate`: a re-auth-capable client would open a re-auth
    // popup from inside THIS popup (verify-session.ts's own guard throws
    // if misconfigured — this call site must never trip it).
    const client = createHttpClient({ baseUrl: config.config.vite_server_url });
    const verifySession = createVerifySession(client);
    const search = authState ? `?auth_state=${encodeURIComponent(authState)}` : '';

    completeAuthCallback({ search, verifySession })
      .then((outcome) => {
        if (cancelled) return;
        setStatus(outcome.status);
        // Old app: closes the popup ~300ms after posting the result
        // (pages/auth/index.jsx). Guarded for jsdom/non-popup contexts.
        setTimeout(() => {
          if (!cancelled && typeof window !== 'undefined' && window.opener) {
            window.close();
          }
        }, 300);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [authState]);

  return (
    // <output>, not <div role="status">: see -ui/RouteStatus.tsx's
    // RoutePending for the same jsx-a11y/prefer-tag-over-role fix.
    <output data-testid="auth-callback-status" data-status={status}>
      {status === 'pending' && t('auth.callback.pending', 'Signing you in…')}
      {status === 'success' && t('auth.callback.success', 'Signed in. You may close this window.')}
      {status === 'error' && t('auth.callback.error', 'Sign-in failed. You may close this window.')}
    </output>
  );
}
