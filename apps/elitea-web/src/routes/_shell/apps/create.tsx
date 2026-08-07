/** ROUTE-037 `/apps/create` -> `CreateToolkit isApplication`. Pattern-A parent of `create/:appType` (ROUTE-038). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { CreateToolkit } from '@/pages/toolkits/CreateToolkit';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/apps/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateToolkitRoute,
});

function CreateToolkitRoute() {
  return (
    <>
      <CreateToolkit isApplication />
      <Outlet />
    </>
  );
}
