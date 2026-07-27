/** ROUTE-035 `/mcps/:tab/:mcpId` -> `EditToolkit isMCP`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/mcps/$tab/$mcpId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="mcps.tab.mcpId" fallback="Edit MCP" />,
});
