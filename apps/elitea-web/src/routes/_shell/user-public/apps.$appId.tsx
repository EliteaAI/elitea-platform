/** ROUTE-046 `/user-public/apps/:appId` -> `AppDetail`. */
import { createFileRoute } from '@tanstack/react-router';

import { AppDetail } from '@/pages/apps/AppDetail';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/user-public/apps/$appId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AppDetailRoute,
});

function AppDetailRoute() {
  return (
    <AppDetail />
  );
}
