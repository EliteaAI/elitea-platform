/**
 * ROUTE-003 `/` -> `IndexRoute` (spec §8.1; PERM-060; faithful port of
 * `apps/elitea-ui/src/[fsd]/app/routes/IndexRoute.jsx:7-27`, decision logic
 * in `-guards/indexRoute.ts`).
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

import { decideIndexRoute } from '../-guards/indexRoute';
import { RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/')({
  beforeLoad: ({ context }) => {
    const decision = decideIndexRoute(context.auth.getUser());
    if (decision.kind === 'redirect') {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
      throw redirect({ to: decision.to });
    }
  },
  component: IndexRouteComponent,
});

function IndexRouteComponent() {
  // Reached only when decideIndexRoute returned 'loading' (user.id not yet
  // known) — beforeLoad already redirected for both other cases.
  return <RoutePending />;
}
