/** ROUTE-010 `/agents/create` -> `CreateApplication` (spec §8.1, nav-block when dirty — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { CreateApplication } from '@/pages/agents/CreateApplication';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/agents/create')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateApplicationRoute,
});

function CreateApplicationRoute() {
  return (
    <CreateApplication />
  );
}
