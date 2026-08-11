/**
 * Admin › Service Descriptors — unit A14, issue #200. The last of the ten.
 *
 * Reference (read-only): `apps/admin-ui/frontend/src/pages/ServiceDescriptorsPage/`
 * (353 lines across a page, a section and a table) plus `api/serviceDescriptorsApi.js`.
 *
 * ## This page is unavailable, and the reason comes from the server
 *
 * A "service descriptor" is not a description of this platform's services. It is
 * one registration in pylon's PROVIDER HUB: an external provider — DeepWiki,
 * Inventory, an image-generation service — that posts an
 * `ExternalServiceProviderDescriptor` naming its URL and the toolkits it offers,
 * which elitea_core stores, health-checks, and thereafter hands to agents through
 * `lookup_provider`. The four columns the reference table renders come from two
 * different places: `project_id`, `provider_name` and `service_location_url` are
 * the stored key, and `healthy` is which of two IN-PROCESS DICTS on the Pylon
 * plugin module the descriptor landed in when that process last started.
 *
 * This platform has no descriptor store, no provider health probe and no provider
 * lookup — the subsystem's only trace in the Go tree is a constant asserting its
 * absence. So there is nothing to list, and a registration would reach nothing.
 * The replacement is specified (ADR-0012 and the Provider Service Protocol) but
 * both are still `In Review`, sit in migration phase P3, and deliberately replace
 * this page's mutable descriptor with an immutable admitted manifest.
 *
 * The page therefore renders the SERVER's sentence, obtained by calling the
 * endpoint and being refused — it does not carry a copy of the reason. That
 * matters more here than anywhere else in this port: a page that hardcoded its
 * own explanation would keep displaying it after someone wired the endpoint to a
 * stub, which is exactly the regression this unit exists to prevent. If the
 * server ever answers 200 with rows, this page shows them.
 *
 * ## What is deliberately absent
 *
 * **The delete control.** The reference offers a per-row delete behind a
 * `window.confirm`, calling `DELETE /elitea_core/register_descriptor/{project_id}`.
 * That endpoint had no route in this platform and a dead handler answering
 * `{"ok": true}` to a discarded body; it now refuses explicitly. A disabled
 * button with a reason would still imply the row it sits beside exists. There are
 * no rows.
 *
 * **The search box.** It filters a client-side array. With nothing to filter it
 * is a control that does nothing, which is this unit's whole subject.
 *
 * ## One more thing worth recording about the reference
 *
 * `ServiceDescriptorsPage.jsx` — the file this page is named after — is itself
 * dead code in `admin_ui`: `routes.js` declares no route for it and nothing
 * imports it. The surface an operator could actually reach is the sibling
 * `ServiceDescriptorsSection`, embedded in the Configuration page. Both are
 * covered: this route exists so the page has a home, and the Configuration
 * section states the same sentence (the Go constant is shared, and a test pins
 * that they are byte-identical).
 *
 * ## Authorisation
 *
 * `window.admin_ui_config.permissions` is presentation state and never a gate —
 * see `./adminUiConfig`. The listing is gated server-side on
 * `runtime.airun.serviceproviders` and the two registration verbs on
 * `provider_hub.descriptor.register`, the permissions the pylon originals
 * declare, resolved in `administration` mode. The gate runs BEFORE the refusal,
 * so a caller without the permission sees an access error rather than learning
 * which subsystems this deployment runs.
 */
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { drawerPage } from '@/features/settings';

import { AdminServiceDescriptorsTable } from './ServiceDescriptorsTable';
import {
  descriptorFailureReason,
  descriptorFailureStatus,
  useAdminServiceDescriptors,
} from './api/adminServiceDescriptorsApi';

const { DrawerPage } = drawerPage;

export function AdminServiceDescriptors() {
  const query = useAdminServiceDescriptors();

  const reason = descriptorFailureReason(query.error);
  const status = descriptorFailureStatus(query.error);
  // 501 is "this platform does not have that subsystem" and any other failure is
  // "the request went wrong". Collapsing them would let a 500 masquerade as a
  // considered architectural decision.
  const isUnavailable = status === 501;

  return (
    <DrawerPage sx={{ padding: '1rem 1.5rem', gap: '0.75rem' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {t('pages.admin.serviceDescriptors.title', 'Service Descriptors')}
      </Typography>

      {query.isPending ? <LinearProgress /> : null}

      {isUnavailable ? (
        <Alert severity="info" data-testid="admin-service-descriptors-unavailable">
          <AlertTitle>
            {t(
              'pages.admin.serviceDescriptors.unavailableTitle',
              'Provider registrations are not available on this platform',
            )}
          </AlertTitle>
          {/* The server's own sentence, not one this page carries. */}
          {reason}
        </Alert>
      ) : null}

      {query.isError && !isUnavailable ? (
        <Alert severity="warning" data-testid="admin-service-descriptors-error">
          {reason ??
            t(
              'pages.admin.serviceDescriptors.error.load',
              'Failed to load the registered service descriptors.',
            )}
        </Alert>
      ) : null}

      {/* Rendered whenever the server answered. If a descriptor store ever
          lands, this page shows it without a further change here — which is
          what stops the explanation above from outliving its truth. */}
      {query.isSuccess ? <AdminServiceDescriptorsTable descriptors={query.data} /> : null}
    </DrawerPage>
  );
}
