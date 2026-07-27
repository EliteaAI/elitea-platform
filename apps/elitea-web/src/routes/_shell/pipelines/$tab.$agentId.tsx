/** ROUTE-020 `/pipelines/:tab/:agentId` -> `EditPipeline` (nav-block — Wave-2 concern). Adds PARAM-059 `history_run_id`. */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/pipelines/$tab/$agentId')({
  validateSearch: pickParams('history_run_id'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="pipelines.tab.agentId" fallback="Edit Pipeline" />
      <Outlet />
    </>
  ),
});
