/**
 * ROUTE-006 `/agents-hub` — now a redirect source only, matching the
 * baseline (`routes.js:85` "Legacy path kept as a redirect source to
 * EliteaCatalog"; `ProtectedRoutes.jsx:194` mounts `LegacyCatalogRedirect`
 * here rather than the hub page).
 *
 * The hub page itself is NOT deleted: it is the agents tab of
 * `/elitea-catalog` (see `pages/elitea-catalog/EliteaCatalog.tsx`).
 *
 * The search string is carried across, because the one link shape that
 * reaches this path in the wild is the shared `?agentId=` deep link. The
 * baseline does it with a raw `to={RouteDefinitions.EliteaCatalog +
 * location.search}`; here the validated search object is forwarded, which
 * is the same set of keys — `validateSearch` below declares both, so
 * neither is dropped on the way through.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

import { pickParams } from '../-search/params';

export const Route = createFileRoute('/_shell/agents-hub')({
  validateSearch: pickParams('agentId', 'tab'),
  beforeLoad: ({ search }) => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/elitea-catalog', search, replace: true });
  },
});
