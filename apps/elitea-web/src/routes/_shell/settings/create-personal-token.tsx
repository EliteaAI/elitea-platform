/** ROUTE-066 `/settings/create-personal-token` -> `CreatePersonalToken` (nav-block — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/create-personal-token')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.create-personal-token" fallback="Create Personal Token" />,
});
