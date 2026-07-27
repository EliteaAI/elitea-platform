/** ROUTE-058 `/settings/secrets` -> `Secrets` (`createSecret` inherited from `settings/route.tsx`). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/secrets')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.secrets" fallback="Secrets" />,
});
