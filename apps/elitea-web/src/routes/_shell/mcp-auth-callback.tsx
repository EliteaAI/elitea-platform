/** ROUTE-050 `/mcp-auth-callback` -> `McpAuthPage` (spec §8.1). Query params PARAM-048..051. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/mcp-auth-callback')({
  validateSearch: pickParams('code', 'error', 'error_description', 'state'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="mcp-auth-callback" fallback="MCP Auth Callback" />,
});
