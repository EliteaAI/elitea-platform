/**
 * ROUTE-063 `/settings/create-configuration` -> `CreateCredentialFromMain`
 * (title "New Configuration", `showCategory=false`, `forceShowTitle` —
 * spec §8.1), wrapped in `IntegrationGuard` (PERM-059). Pattern-A parent of
 * `create-configuration/:credentialType` (ROUTE-064): `beforeLoad` cascades
 * to the child the same way `skillsGuardBeforeLoad` does for the skills
 * family.
 */
import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { CreateCredential } from '@/pages/credentials/CreateCredential';
import { integrationGuardBeforeLoad } from '@/routes/-guards/integrationGuard';
import { useCredentialFormContext } from '@/routes/-lib/useCredentialFormContext';
import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';

/**
 * Same page as `/credentials/create-credential` (ROUTE-023), with
 * `configurationMode` ON — that flag is what turns "New Credential" into
 * "New Configuration" and hides the category selector
 * (`CredentialFormMode.configurationMode`). Leaving returns to the
 * AI-configuration settings screen these are managed from, not to
 * `/credentials`.
 */
function CreateConfigurationRoute() {
  const navigate = useNavigate();
  const context = useCredentialFormContext();
  const leave = useCallback(() => {
    void navigate({ to: '/settings/model-configuration' });
  }, [navigate]);

  return (
    <>
      <CreateCredential
        context={context}
        configurationMode
        onCreated={leave}
        onCancelled={leave}
      />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/_shell/settings/create-configuration')({
  beforeLoad: integrationGuardBeforeLoad,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateConfigurationRoute,
});
