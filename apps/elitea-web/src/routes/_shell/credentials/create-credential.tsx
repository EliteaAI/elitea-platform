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
 *
 * `:credentialType` (ROUTE-024) is a real deep-link entry point in the
 * baseline, not decoration: `components/CredentialWarningBanner.jsx:43`
 * builds `CreateCredentialTypeFromMain.replace(':credentialType', type)`
 * whenever it knows the type, and `hooks/credentials/useCredentialSearch.js:29`
 * navigates there when a type is picked. `pages/Credentials/CreateCredential.jsx`
 * then reads it with a single `useParams()` (:24) and shows the FORM instead
 * of the type selector (`isEditing` at :132 requires `credentialType`).
 * Since ROUTE-024 is an empty pattern-A child with no component of its own,
 * this parent reads the param the same way the baseline does — one
 * `useParams`, `strict: false` because the param belongs to the child match.
 */
import { createFileRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useCallback } from 'react';

import { CreateCredential } from '@/pages/credentials/CreateCredential';

import { useCredentialFormContext } from '../../-lib/useCredentialFormContext';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

function CreateCredentialRoute() {
  const navigate = useNavigate();
  const context = useCredentialFormContext();
  const { credentialType } = useParams({ strict: false });
  const leave = useCallback(() => {
    void navigate({ to: '/credentials' });
  }, [navigate]);

  return (
    <>
      <CreateCredential
        context={context}
        {...(credentialType !== undefined ? { credentialType } : {})}
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
