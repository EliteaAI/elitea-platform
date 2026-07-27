/** ROUTE-010 `/agents/create` -> `CreateApplication` (spec §8.1, nav-block when dirty — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/agents/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="agents.create" fallback="Create Application" />,
});
