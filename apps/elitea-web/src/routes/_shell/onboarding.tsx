/** ROUTE-004 `/onboarding` -> `Onboarding` (spec §8.1). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { RouteShell } from '../-ui/RouteShell';

export const Route = createFileRoute('/_shell/onboarding')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="onboarding" fallback="Onboarding" />
      <Outlet />
    </>
  ),
});
