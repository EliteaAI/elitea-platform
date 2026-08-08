/** ROUTE-018 `/pipelines/create` -> `CreatePipeline` (nav-block when dirty — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { CreatePipeline } from '@/pages/pipelines/CreatePipeline';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/pipelines/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreatePipelineRoute,
});

function CreatePipelineRoute() {
  return (
    <CreatePipeline />
  );
}
