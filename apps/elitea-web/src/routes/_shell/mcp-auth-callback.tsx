/** ROUTE-050 `/mcp-auth-callback` -> `McpAuthCallbackPage` (spec §8.1). Query params PARAM-048..051. */
import { createFileRoute } from '@tanstack/react-router';

import { McpAuthCallbackPage } from '@/pages/mcps/McpAuthCallbackPage';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/mcp-auth-callback')({
  validateSearch: pickParams('code', 'error', 'error_description', 'state'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: McpAuthCallbackRoute,
});

// Named `McpAuthCallbackRoute`, never `McpAuthCallbackPage`: this file used to
// declare a local stub component under the page's own name, which shadowed the
// real import and made every grep for `McpAuthCallbackPage` appear to find a
// wired route. Keeping the wrapper's name distinct from the page's makes that
// shadowing impossible to reintroduce silently.
function McpAuthCallbackRoute() {
  return (
    <McpAuthCallbackPage />
  );
}
