/** ROUTE-058 `/settings/secrets` -> `Secrets` page. */
import { createFileRoute } from '@tanstack/react-router';

import { pickParams } from '@/routes/-search/params';
import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { RouteShell } from '@/routes/-ui/RouteShell';
import { SecretsContent } from '@/routes/_shell/settings/secrets/SecretsContent';

export const Route = createFileRoute('/_shell/settings/secrets')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  validateSearch: pickParams('createSecret'),
  component: SecretsPage,
});

function SecretsPage() {
  const { createSecret } = Route.useSearch();
  return (
    <>
      <RouteShell routeId="settings.secrets" fallback="Secrets" />
      <SecretsContent shouldCreate={createSecret === '1'} search="" onSearchChange={() => {}} />
    </>
  );
}
