/** ROUTE-043 `/user-public/pipelines/:agentId` -> `EditPipeline`. */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { EditPipeline } from '@/pages/pipelines/EditPipeline';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/user-public/pipelines/$agentId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditPipelineRoute,
});

function EditPipelineRoute() {
  return (
    <>
      <EditPipeline />
      <Outlet />
    </>
  );
}
