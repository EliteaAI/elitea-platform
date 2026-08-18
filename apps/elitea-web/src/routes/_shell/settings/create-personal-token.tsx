/**
 * ROUTE-066 `/settings/create-personal-token` -> `CreatePersonalToken` page.
 *
 * The page itself is `routes/-pages/CreatePersonalToken.tsx`. This file holds
 * the route definition only, and it does not export the component — see
 * `tokens.tsx` for why that matters to the bundle budget (issue #493). This
 * page is the only reason `react-hook-form` and `@hookform/resolvers` were in
 * the initial bundle.
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { CreatePersonalTokenPage } from '@/routes/-pages/CreatePersonalToken';

export const Route = createFileRoute('/_shell/settings/create-personal-token')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreatePersonalTokenPage,
});
