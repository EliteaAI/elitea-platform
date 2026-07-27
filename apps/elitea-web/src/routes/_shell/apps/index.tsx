/**
 * ROUTE-036 `/apps` -> `Apps` (spec §8.1). NOT an index-redirect (unlike
 * agents/skills/pipelines/credentials/toolkits/mcps): old app renders the
 * SAME `<Apps/>` component for both `{ path: Apps }` and
 * `{ path: AppsWithTab }` (`ProtectedRoutes.jsx:228,231`).
 *
 * `apps/index.tsx` (not `apps/route.tsx` or a flat `apps.tsx`): verified
 * against the installed `@tanstack/router-generator@1.168.23` that an
 * `index.tsx` file resolves to its parent directory's exact path
 * (`/apps`) WITHOUT becoming the structural parent of sibling files
 * (`apps/create.tsx`, `apps/$tab.tsx`) — the same non-nesting property
 * `agents/index.tsx` relies on. This renders real content directly (no
 * `beforeLoad` redirect, unlike the agents/skills/pipelines/etc. index
 * routes) while keeping `/apps/create*` and `/apps/:tab*` as independent
 * siblings, exactly matching old app's flat route array.
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/apps/')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="apps" fallback="Apps" />,
});
