/** ROUTE-018 `/pipelines/create` -> `CreatePipeline` (nav-block when dirty — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/pipelines/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="pipelines.create" fallback="Create Pipeline" />,
});
