/** ROUTE-025 `/credentials/:tab/:credential_uid` -> `EditCredentialFromMain` (nav-block — Wave-2 concern). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/credentials/$tab/$credential_uid')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="credentials.tab.credential_uid" fallback="Edit Credential" />,
});
