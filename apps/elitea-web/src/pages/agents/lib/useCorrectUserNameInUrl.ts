import { useEffect } from 'react';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useCorrectUserNameInUrl.js`
 * — a purely cosmetic "keep `?name=` in the address bar in sync with the
 * application's real name" effect (`EditApplication.jsx:65`,
 * `useCorrectUserNameInUrl(initialValues?.name)`). One of the four hooks
 * the promotion pass explicitly flagged as NOT promoted into any `entities/`
 * slice ("judged pure chat/RTK-Query orchestration with no real Application/
 * Toolkit domain content") — built locally here since `EditApplication.tsx`
 * (this unit, A1g) is its only owner-side caller.
 *
 * **Real, disclosed constraint forcing a deviation from a byte-for-byte
 * port:** the baseline reads/writes `name` via react-router-dom's
 * `useSearchParams()`, an untyped, unvalidated key/value bag. This app's
 * router is TanStack Router, where every route's search state is validated
 * against a zod schema (`src/routes/-search/params.ts`'s `pickParams`) — and
 * neither `/agents/$tab` nor `/agents/$tab/$agentId` (`src/routes/_shell/
 * agents/$tab.tsx`, `$tab.$agentId.tsx`) declares a `name` key in that
 * schema. `src/routes/**` is outside this unit's ownership fence, and
 * `pages/` importing from `routes/` would invert the intended composition
 * direction (routes render pages, not the reverse) even if it weren't.
 * Going through TanStack's typed `useSearch`/`navigate` would therefore have
 * the written `name` key silently STRIPPED on the very next re-validation
 * (zod's `z.object()` default-strips unknown keys) — a real regression, not
 * a faithful port. This hook instead talks to `window.location`/
 * `history.replaceState` directly, exactly as narrow as the baseline's own
 * `useSearchParams` (also an unvalidated bag) and with the same observable
 * effect (the URL's `?name=` mirrors the real name, no navigation/history
 * entry, no rerender loop) — without requiring a `src/routes/` change.
 */
export function useCorrectUserNameInUrl(realName: string | undefined): void {
  useEffect(() => {
    if (realName === undefined || realName === '') return;
    const url = new URL(window.location.href);
    const nameFromUrl = url.searchParams.get('name') ?? '';
    if (nameFromUrl === realName) return;
    url.searchParams.set('name', realName);
    window.history.replaceState(window.history.state as unknown, '', url);
  }, [realName]);
}
