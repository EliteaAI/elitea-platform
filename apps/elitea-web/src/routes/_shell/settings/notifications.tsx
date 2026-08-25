/**
 * ROUTE-062 `/settings/notifications` — notification center settings page.
 *
 * The page itself is `routes/-pages/Notifications.tsx`. This file holds the
 * route definition only, and it does not export the component — see
 * `tokens.tsx` for why that matters to the bundle budget (issue #493).
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { NotificationsPage } from '@/routes/-pages/Notifications';

export const Route = createFileRoute('/_shell/settings/notifications')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: NotificationsPage,
});
