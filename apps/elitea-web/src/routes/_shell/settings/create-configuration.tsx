/**
 * ROUTE-063 `/settings/create-configuration` -> `CreateCredentialFromMain`
 * (title "New Configuration", `showCategory=false`, `forceShowTitle` —
 * spec §8.1), wrapped in `IntegrationGuard` (PERM-059). Pattern-A parent of
 * `create-configuration/:credentialType` (ROUTE-064): `beforeLoad` cascades
 * to the child the same way `skillsGuardBeforeLoad` does for the skills
 * family.
 */
import { createFileRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router';
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
 *
 * `:credentialType` (ROUTE-064) is threaded for the same reason its
 * `/credentials` twin threads it — see `create-credential.tsx`'s header for
 * the baseline citations. The settings side has its own deep-link producer:
 * `hooks/credentials/useCredentialSearch.js:29` picks
 * `CreateConfigurationWithType` over `CreateCredentialTypeFromMain`
 * whenever the user is inside the settings route.
 */
function CreateConfigurationRoute() {
  const navigate = useNavigate();
  const context = useCredentialFormContext();
  const { credentialType } = useParams({ strict: false });
  const leave = useCallback(() => {
    void navigate({ to: '/settings/model-configuration' });
  }, [navigate]);
  // Navigates to ROUTE-064, not ROUTE-024 — `useCredentialSearch.js:29`
  // switches destination on `isFromSettings` for exactly this reason: a type
  // picked inside settings must stay inside settings, or the user lands on
  // the credentials-domain screen with `configurationMode` silently off.
  const chooseType = useCallback(
    (type: string) => {
      void navigate({ to: '/settings/create-configuration/$credentialType', params: { credentialType: type } });
    },
    [navigate],
  );

  return (
    <>
      <CreateCredential
        context={context}
        {...(credentialType !== undefined ? { credentialType } : {})}
        configurationMode
        onCreated={leave}
        onCancelled={leave}
        onTypeChosen={chooseType}
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
