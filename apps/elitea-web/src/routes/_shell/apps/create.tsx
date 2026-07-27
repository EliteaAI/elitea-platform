/** ROUTE-037 `/apps/create` -> `CreateToolkit isApplication`. Pattern-A parent of `create/:appType` (ROUTE-038). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/apps/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="apps.create" fallback="Create App" />
      <Outlet />
    </>
  ),
});
