/** ROUTE-004 `/onboarding` -> `Onboarding` (spec §8.1). */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import Onboarding from '@/pages/onboarding/Onboarding';

import { RouteError, RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/onboarding')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: OnboardingRoute,
});

function OnboardingRoute() {
  return (
    <>
      <Onboarding />
      <Outlet />
    </>
  );
}
