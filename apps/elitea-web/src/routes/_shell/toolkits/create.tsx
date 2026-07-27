/** ROUTE-027 `/toolkits/create` -> `CreateToolkit`. Pattern-A parent of `create/:toolkitType` (ROUTE-028, nav-block — Wave-2 concern). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/toolkits/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="toolkits.create" fallback="Create Toolkit" />
      <Outlet />
    </>
  ),
});
