/** ROUTE-047 `/mode-switch` -> `ModeSwitch` (spec §8.1). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';

export const Route = createFileRoute('/_shell/mode-switch')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="mode-switch" fallback="Mode Switch" />,
});
