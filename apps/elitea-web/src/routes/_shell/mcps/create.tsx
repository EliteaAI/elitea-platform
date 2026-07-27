/** ROUTE-032 `/mcps/create` -> `CreateToolkit isMCP`. Pattern-A parent of `create/:mcpType` (ROUTE-033). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/mcps/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="mcps.create" fallback="Create MCP" />
      <Outlet />
    </>
  ),
});
