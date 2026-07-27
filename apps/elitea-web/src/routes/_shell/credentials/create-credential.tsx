/**
 * ROUTE-023 `/credentials/create-credential` -> `CreateCredentialFromMain`
 * (nav-block — Wave-2 concern). Old app renders the SAME component for
 * this and `create-credential/:credentialType` (ROUTE-024) — the "pattern
 * A" empty-child shape (own content unconditional + `<Outlet/>`), like
 * `agents/$tab/$agentId/$version`.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/credentials/create-credential')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <>
      <RouteShell routeId="credentials.create-credential" fallback="New Credential" />
      <Outlet />
    </>
  ),
});
