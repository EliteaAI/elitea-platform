/** ROUTE-040 `/apps/:tab/:appId` -> `AppDetail`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/apps/$tab/$appId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="apps.tab.appId" fallback="App Detail" />,
});
