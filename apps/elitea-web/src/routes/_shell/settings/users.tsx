/** ROUTE-059 `/settings/users` -> `Users`. Query param PARAM-061 `inviteUsers` (spec QP-002). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/settings/users')({
  validateSearch: pickParams('inviteUsers'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.users" fallback="Users" />,
});
