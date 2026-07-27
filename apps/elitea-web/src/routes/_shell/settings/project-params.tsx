/** ROUTE-055 `/settings/project-params` -> `ProjectContextSettings`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/project-params')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.project-params" fallback="Project Parameters" />,
});
