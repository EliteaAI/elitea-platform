/** ROUTE-062 `/settings/notifications` -> `NotificationCenter`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { RouteShell } from '@/routes/-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/notifications')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.notifications" fallback="Notifications" />,
});
