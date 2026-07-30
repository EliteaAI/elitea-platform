/**
 * ROUTE-065 `/settings/edit-configuration/:credential_uid` ->
 * `EditCredentialFromMain` (title "Configuration"). Spec §8.1 note: "the
 * param is `:credential_uid`, while `RouteDefinitions.EditConfiguration`
 * declares `:uid`; the MOUNTED route wins" — this file uses
 * `$credential_uid`, not `$uid`.
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { RouteShell } from '@/routes/-ui/RouteShell';

export const Route = createFileRoute('/_shell/settings/edit-configuration/$credential_uid')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="settings.edit-configuration.credential_uid" fallback="Configuration" />,
});
