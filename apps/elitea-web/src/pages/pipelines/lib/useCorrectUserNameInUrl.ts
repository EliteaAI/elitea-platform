import { useEffect } from 'react';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useCorrectUserNameInUrl.js`
 * — a purely cosmetic "keep `?name=` in the address bar in sync with the
 * pipeline's real name" effect (`EditPipeline.jsx` reads `initialValues?.name`
 * via a shared application hook the same way `EditApplication.jsx` does).
 * One of the four hooks the Wave-2 promotion pass explicitly flagged as NOT
 * promoted into any `entities/` slice ("judged pure chat/RTK-Query
 * orchestration with no real Application/Toolkit domain content") — built
 * locally here since `EditPipeline.tsx` (this unit, A2m) is its only
 * owner-side caller. Same body as `pages/agents/lib/useCorrectUserNameInUrl.ts`
 * (Wave-2 unit A1g) — see that file's doc comment for the full, real
 * constraint this reproduces: TanStack Router's typed `useSearch()` would
 * silently strip an undeclared `name` search key on the next re-validation
 * (neither `/pipelines/$tab` nor `/pipelines/$tab/$agentId` declares one,
 * `src/routes/_shell/pipelines/**`), so this talks to
 * `window.location`/`history.replaceState` directly instead, matching the
 * baseline's own equally-unvalidated `useSearchParams` behaviour.
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
