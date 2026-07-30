/** ROUTE-058 `/settings/secrets` -> `Secrets` page. */
import { createFileRoute } from '@tanstack/react-router';

import { pickParams } from '@/routes/-search/params';
import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { SecretsContent } from '@/routes/_shell/settings/secrets/SecretsContent';

export const Route = createFileRoute('/_shell/settings/secrets')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  validateSearch: pickParams('createSecret'),
  component: SecretsPage,
});

function SecretsPage() {
  const { createSecret } = Route.useSearch();
  return <SecretsContent shouldCreate={createSecret === '1'} search="" onSearchChange={() => {}} />;
}
