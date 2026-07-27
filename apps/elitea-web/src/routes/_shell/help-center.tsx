/** ROUTE-005 `/help-center` -> `Resources` (spec §8.1). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';

export const Route = createFileRoute('/_shell/help-center')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="help-center" fallback="Help Center" />,
});
