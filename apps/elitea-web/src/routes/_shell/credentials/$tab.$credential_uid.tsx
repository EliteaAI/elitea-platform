/**
 * ROUTE-025 `/credentials/:tab/:credential_uid` -> `EditCredentialFromMain`.
 *
 * "FromMain" is not a separate component: it is `EditCredential` with the
 * main-app context, i.e. `configurationMode` left off.
 * `/settings/edit-configuration/:credential_uid` (ROUTE-065) renders the
 * same page with `configurationMode` on.
 *
 * `onSaved`/`onDiscarded` both return to the tab this row was opened from —
 * `:tab` is preserved rather than hard-coding `/credentials`, so leaving the
 * editor lands back where the user actually was.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { EditCredential } from '@/pages/credentials/EditCredential';

import { useCredentialFormContext } from '../../-lib/useCredentialFormContext';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

function EditCredentialRoute() {
  const navigate = useNavigate();
  const { tab, credential_uid: credentialUid } = Route.useParams();
  const context = useCredentialFormContext();
  const leave = useCallback(() => {
    void navigate({ to: '/credentials/$tab', params: { tab } });
  }, [navigate, tab]);

  return (
    <EditCredential
      context={context}
      credentialUid={credentialUid}
      onSaved={leave}
      onDiscarded={leave}
    />
  );
}

export const Route = createFileRoute('/_shell/credentials/$tab/$credential_uid')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditCredentialRoute,
});
