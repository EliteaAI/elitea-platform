/**
 * ROUTE-041 `/user-public/:tab` -> `UserPublic`. Query param PARAM-108
 * `statuses`. Deliberately does NOT use `user-public/route.tsx` or a flat
 * `user-public.tsx` — ROUTE-075 (bare `/user-public`, no `:tab`) is a
 * declared-but-never-mounted anomaly (D4: swallowed by ROUTE-070's
 * `$projectId/$`) and must stay unmounted; only `$tab.tsx` and the sibling
 * `agents.$agentId.tsx`/etc. files exist in this directory.
 *
 * Phase 1b — this route owns all six of `UserPublicPageProps`. Notes on the
 * two that are not simply "read the URL":
 *
 * - `author_id`/`author_name` are added to `validateSearch` here. They are
 *   PARAM-062/063, which the manifest scopes to "any" route rather than to
 *   one — this page is the only consumer that needs them, and the old app
 *   puts them on exactly this URL
 *   (`apps/elitea-ui/src/hooks/useCardNavigate.js:395-401` builds
 *   `/user-public/{tab}?viewMode=…&author_id=…&author_name=…`). Adding them
 *   surfaces existing cross-cutting params; it does not widen ROUTE-041's
 *   own contract. `pages/user-public`'s own doc comment flagged their
 *   absence as the reason the page could not be wired.
 * - `viewMode` from that same baseline URL is deliberately NOT threaded:
 *   `UserPublicPage` derives owner-vs-public from the router's
 *   `auth` context (`useIsPublicProject`), not from the query string, so
 *   passing it would introduce a second, conflicting source of truth.
 *
 * `:tab` is narrowed rather than cast — an out-of-vocabulary tab falls back
 * to the first tab instead of reaching the page as an invalid value. The
 * baseline does the same (`useCardNavigate.js:400`:
 * `UserPublicTabs.find(item => item === tab) ? tab : UserPublicTabs[0]`).
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { UserPublicPage } from '@/pages/user-public/ui/UserPublicPage';
import type { UserPublicTabValue } from '@/pages/user-public/lib/constants';

import { toAuthorField, toStatuses, toTabValue } from '../../-lib/userPublicParams';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { pickParams } from '../../-search/params';

function UserPublicRoute() {
  const navigate = useNavigate();
  const { tab } = Route.useParams();
  const { statuses, author_id: authorId, author_name: authorName } = Route.useSearch();

  const onTabChange = useCallback((next: UserPublicTabValue) => {
    void navigate({ to: '/user-public/$tab', params: { tab: next }, search: (prev) => prev });
  }, [navigate]);

  const onStatusesChange = useCallback((next: readonly string[]) => {
    void navigate({ to: '.', search: (prev) => ({ ...prev, statuses: [...next] }) });
  }, [navigate]);

  return (
    <ExclusiveOutlet>
      <UserPublicPage
        tab={toTabValue(tab)}
        onTabChange={onTabChange}
        statuses={toStatuses(statuses)}
        onStatusesChange={onStatusesChange}
        authorId={toAuthorField(authorId)}
        authorName={toAuthorField(authorName)}
      />
    </ExclusiveOutlet>
  );
}

export const Route = createFileRoute('/_shell/user-public/$tab')({
  validateSearch: pickParams('statuses', 'author_id', 'author_name'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: UserPublicRoute,
});
