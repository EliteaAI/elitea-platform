/** ROUTE-054 `/settings/environment` -> `EnvironmentSettings`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/environment')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.environment" fallback="Environment" />,
});
