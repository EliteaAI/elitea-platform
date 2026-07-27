/** ROUTE-006 `/agents-hub` -> `AgentHub` (spec §8.1). Query param PARAM-021 `agentId`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/agents-hub')({
  validateSearch: pickParams('agentId'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="agents-hub" fallback="Agent Hub" />,
});
