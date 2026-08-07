/** ROUTE-027 `/toolkits/create` -> `CreateToolkit`. Pattern-A parent of `create/:toolkitType` (ROUTE-028, nav-block — Wave-2 concern). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { CreateToolkit } from '@/pages/toolkits/CreateToolkit';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/toolkits/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateToolkitRoute,
});

function CreateToolkitRoute() {
  return (
    <>
      <CreateToolkit />
      <Outlet />
    </>
  );
}
