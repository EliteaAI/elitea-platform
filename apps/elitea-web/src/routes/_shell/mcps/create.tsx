/** ROUTE-032 `/mcps/create` -> `CreateToolkit isMCP`. Pattern-A parent of `create/:mcpType` (ROUTE-033). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { CreateToolkit } from '@/pages/toolkits/CreateToolkit';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/mcps/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateToolkitRoute,
});

function CreateToolkitRoute() {
  return (
    <>
      <CreateToolkit isMCP />
      <Outlet />
    </>
  );
}
