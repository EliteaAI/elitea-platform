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

import { pickParams } from '../../-search/params';
import { useCredentialFormContext } from '../../-lib/useCredentialFormContext';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';

function CreateCredentialRoute() {
  const navigate = useNavigate();
  const context = useCredentialFormContext();
  const { credentialType } = useParams({ strict: false });
  /**
   * DEFECT: this route declared none of PARAM-037/039/041/043/045 and read
   * none of them, so every one was dropped. `CredentialWarningBanner` builds
   * `/credentials/create-credential/{type}?prefill_id=...&prefill_name=...
   * &section=...`; the form then opened with an empty name and read the type
   * catalogue for every section instead of the one the link named.
   */
  const { prefill_id: prefillId, prefill_name: prefillName, section } = Route.useSearch();
  const leave = useCallback(() => {
    void navigate({ to: '/credentials' });
  }, [navigate]);
  // Picking a type NAVIGATES to ROUTE-024 rather than setting page state, so
  // the URL always names the type on screen — the baseline's own model
  // (`hooks/credentials/useCredentialSearch.js:29` navigates to
  // `CreateCredentialTypeFromMain` on selection). That is what makes Back
  // from the form return to the picker, and what makes the resulting URL
  // shareable — the same URL `CredentialWarningBanner` hands out.
  const chooseType = useCallback(
    (type: string) => {
      void navigate({ to: '/credentials/create-credential/$credentialType', params: { credentialType: type } });
    },
    [navigate],
  );

  return (
    <>
      <CreateCredential
        context={context}
        {...(credentialType !== undefined ? { credentialType } : {})}
        {...(prefillId !== '' ? { prefillId } : {})}
        {...(prefillName !== '' ? { prefillName } : {})}
        {...(section !== '' ? { section } : {})}
        onCreated={leave}
        onCancelled={leave}
        onTypeChosen={chooseType}
      />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/_shell/credentials/create-credential')({
  validateSearch: pickParams('forceCustom', 'from', 'prefill_id', 'prefill_name', 'section'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateCredentialRoute,
});
