/** ROUTE-005 `/help-center` -> `Resources` (spec §8.1). */
import { createFileRoute } from '@tanstack/react-router';

import HelpCenterPage from '@/pages/help-center/HelpCenterPage';

import { RouteError, RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/help-center')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: HelpCenterPageRoute,
});

function HelpCenterPageRoute() {
  return (
    <HelpCenterPage />
  );
}
