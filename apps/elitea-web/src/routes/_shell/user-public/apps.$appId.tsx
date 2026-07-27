/** ROUTE-046 `/user-public/apps/:appId` -> `AppDetail`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/user-public/apps/$appId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="user-public.apps.appId" fallback="App Detail (Public)" />,
});
