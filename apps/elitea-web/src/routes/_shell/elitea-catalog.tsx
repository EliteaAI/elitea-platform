/**
 * `/elitea-catalog` -> `EliteaCatalog` — the two-tab agent + skill catalogue
 * (baseline `ProtectedRoutes.jsx:193`, `RouteDefinitions.EliteaCatalog`).
 *
 * Search contract: `tab` (which catalogue) plus `agentId`, which the agents
 * tab still reads for its deep-linked modal — the baseline's `AgentModal`
 * builds exactly `${EliteaCatalog}?tab=agents&agentId=...`
 * (`AgentModal.jsx:73`), so both keys must survive validation here or the
 * share link opens the catalogue with no modal.
 */
import { createFileRoute } from '@tanstack/react-router';

import { EliteaCatalog } from '@/pages/elitea-catalog';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/elitea-catalog')({
  validateSearch: pickParams('tab', 'agentId'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EliteaCatalogRoute,
});

function EliteaCatalogRoute() {
  return (
    <EliteaCatalog />
  );
}
