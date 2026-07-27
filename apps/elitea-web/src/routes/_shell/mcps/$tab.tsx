/** ROUTE-034 `/mcps/:tab` -> `Toolkits isMCP` (no mcps-specific query params in P1's manifest — shell-common scope only). */
import { createFileRoute } from '@tanstack/react-router';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/mcps/$tab')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <ExclusiveOutlet>
      <RouteShell routeId="mcps.tab" fallback="MCPs" />
    </ExclusiveOutlet>
  ),
});
