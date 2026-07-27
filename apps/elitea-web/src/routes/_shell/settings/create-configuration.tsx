/**
 * ROUTE-063 `/settings/create-configuration` -> `CreateCredentialFromMain`
 * (title "New Configuration", `showCategory=false`, `forceShowTitle` —
 * spec §8.1), wrapped in `IntegrationGuard` (PERM-059). Pattern-A parent of
 * `create-configuration/:credentialType` (ROUTE-064): `beforeLoad` cascades
 * to the child the same way `skillsGuardBeforeLoad` does for the skills
 * family.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { integrationGuardBeforeLoad } from '../../-guards/integrationGuard';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/create-configuration')({
  beforeLoad: integrationGuardBeforeLoad,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="settings.create-configuration" fallback="New Configuration" />
      <Outlet />
    </>
  ),
});
