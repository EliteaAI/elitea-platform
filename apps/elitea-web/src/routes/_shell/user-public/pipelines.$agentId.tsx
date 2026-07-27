/** ROUTE-043 `/user-public/pipelines/:agentId` -> `EditPipeline`. */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/user-public/pipelines/$agentId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="user-public.pipelines.agentId" fallback="Edit Pipeline (Public)" />
      <Outlet />
    </>
  ),
});
