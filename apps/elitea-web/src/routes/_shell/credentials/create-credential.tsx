/**
 * ROUTE-023 `/credentials/create-credential` -> `CreateCredentialFromMain`.
 * Old app renders the SAME component for this and
 * `create-credential/:credentialType` (ROUTE-024) — the "pattern A"
 * empty-child shape (own content unconditional + `<Outlet/>`), like
 * `agents/$tab/$agentId/$version`.
 *
 * "FromMain" in the docstring target is not a separate component: it is
 * `CreateCredential` with the main-app context, i.e. `configurationMode`
 * left off. `/settings/create-configuration` (ROUTE-063) renders the same
 * page with `configurationMode` on.
 *
 * `onCreated`/`onCancelled` both return to the credentials list — the route
 * owns navigation, the page owns the form (§3.2).
 */
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { CreateCredential } from '@/pages/credentials/CreateCredential';

import { useCredentialFormContext } from '../../-lib/useCredentialFormContext';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

function CreateCredentialRoute() {
  const navigate = useNavigate();
  const context = useCredentialFormContext();
  const leave = useCallback(() => {
    void navigate({ to: '/credentials' });
  }, [navigate]);

  return (
    <>
      <CreateCredential
        context={context}
        onCreated={leave}
        onCancelled={leave}
      />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/_shell/credentials/create-credential')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateCredentialRoute,
});
