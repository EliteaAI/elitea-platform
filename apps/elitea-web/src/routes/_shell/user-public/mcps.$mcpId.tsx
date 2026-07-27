/** ROUTE-045 `/user-public/mcps/:mcpId` -> `EditToolkit isMCP`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/user-public/mcps/$mcpId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="user-public.mcps.mcpId" fallback="Edit MCP (Public)" />,
});
