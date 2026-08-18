/**
 * ROUTE-057 `/settings/tokens` -> `PersonalTokens` page.
 *
 * The page itself is `routes/-pages/PersonalTokens.tsx`. This file holds the
 * route definition only, and it does not export the component: the router
 * plugin's code splitter refuses to move an EXPORTED `component` into a lazy
 * chunk, so while the page lived here — exported for its own unit test — the
 * whole personal-tokens screen, plus the sidebar widget it reads the project
 * list from, sat in the initial bundle (issue #493).
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { PersonalTokensPage } from '@/routes/-pages/PersonalTokens';

export const Route = createFileRoute('/_shell/settings/tokens')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: PersonalTokensPage,
});
