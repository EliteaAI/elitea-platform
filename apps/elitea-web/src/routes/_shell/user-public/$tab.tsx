/**
 * ROUTE-041 `/user-public/:tab` -> `UserPublic`. Query param PARAM-108
 * `statuses`. Deliberately does NOT use `user-public/route.tsx` or a flat
 * `user-public.tsx` — ROUTE-075 (bare `/user-public`, no `:tab`) is a
 * declared-but-never-mounted anomaly (D4: swallowed by ROUTE-070's
 * `$projectId/$`) and must stay unmounted; only `$tab.tsx` and the sibling
 * `agents.$agentId.tsx`/etc. files exist in this directory.
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/user-public/$tab')({
  validateSearch: pickParams('statuses'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="user-public.tab" fallback="User Public" />,
});
