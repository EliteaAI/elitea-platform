/** ROUTE-006 `/agents-hub` -> `AgentHub` (spec §8.1). Query param PARAM-021 `agentId`. */
import { createFileRoute } from '@tanstack/react-router';

import AgentHub from '@/pages/agents-hub/AgentHub';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/agents-hub')({
  validateSearch: pickParams('agentId'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AgentHubRoute,
});

function AgentHubRoute() {
  return (
    <AgentHub />
  );
}
