/** ROUTE-057 `/settings/tokens` -> `TokensSettings`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/tokens')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.tokens" fallback="Personal Tokens" />,
});
