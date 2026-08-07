/** ROUTE-042 `/user-public/agents/:agentId` -> `EditApplication` (nav-block — Wave-2 concern). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { EditApplication } from '@/pages/agents/EditApplication';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/user-public/agents/$agentId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditApplicationRoute,
});

function EditApplicationRoute() {
  return (
    <>
      <EditApplication />
      <Outlet />
    </>
  );
}
