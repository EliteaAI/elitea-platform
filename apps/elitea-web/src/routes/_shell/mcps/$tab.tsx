/** ROUTE-034 `/mcps/:tab` -> `Toolkits isMCP` (no mcps-specific query params in P1's manifest — shell-common scope only). */
import { createFileRoute } from '@tanstack/react-router';

import { Toolkits } from '@/pages/toolkits/Toolkits';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/mcps/$tab')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ToolkitsRoute,
});

function ToolkitsRoute() {
  return (
    <ExclusiveOutlet>
      <Toolkits isMCP />
    </ExclusiveOutlet>
  );
}
