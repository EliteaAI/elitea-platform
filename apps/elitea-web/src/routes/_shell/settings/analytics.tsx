/** ROUTE-060 `/settings/analytics` -> `AnalyticsContainer`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { RouteShell } from '@/routes/-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/analytics')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.analytics" fallback="Analytics" />,
});
