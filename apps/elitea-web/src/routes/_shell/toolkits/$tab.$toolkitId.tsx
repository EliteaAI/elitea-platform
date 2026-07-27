/** ROUTE-030 `/toolkits/:tab/:toolkitId` -> `EditToolkit` (nav-block on any dirty — Wave-2 concern). Adds PARAM-047 `index_name` (indexes panel). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/toolkits/$tab/$toolkitId')({
  validateSearch: pickParams('index_name'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="toolkits.tab.toolkitId" fallback="Edit Toolkit" />
      <Outlet />
    </>
  ),
});
