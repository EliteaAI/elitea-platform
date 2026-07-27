/** ROUTE-044 `/user-public/toolkits/:toolkitId` -> `EditToolkit`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/user-public/toolkits/$toolkitId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="user-public.toolkits.toolkitId" fallback="Edit Toolkit (Public)" />,
});
