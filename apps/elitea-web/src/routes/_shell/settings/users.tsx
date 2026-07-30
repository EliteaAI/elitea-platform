/**
 * ROUTE-059 `/settings/users` -> `Users`. Query param PARAM-061 `inviteUsers`.
 *
 * Replaces the RouteShell stub with the actual `UsersPage` component.
 * The users page needs the project ID from the route context.
 */
import { createFileRoute, useRouteContext } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { pickParams } from '@/routes/-search/params';
import { UsersPage } from './users-page';

export const Route = createFileRoute('/_shell/settings/users')({
  validateSearch: pickParams('inviteUsers'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: UsersPageComponent,
});

function UsersPageComponent() {
  const context = useRouteContext({ strict: false });
  const projectId =
    (context as { auth?: { getSelectedProjectId?: () => string | undefined } })
      ?.auth?.getSelectedProjectId?.() ?? '';

  return <UsersPage projectId={projectId} />;
}
