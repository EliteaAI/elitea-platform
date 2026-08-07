/** ROUTE-040 `/apps/:tab/:appId` -> `AppDetail`. */
import { createFileRoute } from '@tanstack/react-router';

import { AppDetail } from '@/pages/apps/AppDetail';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/apps/$tab/$appId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AppDetailRoute,
});

function AppDetailRoute() {
  return (
    <AppDetail />
  );
}
