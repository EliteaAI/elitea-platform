/** ROUTE-042 `/user-public/agents/:agentId` -> `EditApplication` (nav-block — Wave-2 concern). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/user-public/agents/$agentId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="user-public.agents.agentId" fallback="Edit Application (Public)" />
      <Outlet />
    </>
  ),
});
