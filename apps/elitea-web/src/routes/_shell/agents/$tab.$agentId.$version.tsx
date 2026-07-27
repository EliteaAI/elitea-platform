/**
 * ROUTE-067 `/agents/:tab/:agentId/:version` (spec §8.1: "`:version` sub-routes
 * — `ProtectedRoutes.jsx:281-287` appends a `:version` child to every route
 * whose path ends `/:agentId` or `/:skillId`; the element is empty, so the
 * parent renders and reads the param"). No component: TanStack's default
 * (verified against the installed `@tanstack/react-router`'s `Match.js`:
 * `route.options.component ?? router.options.defaultComponent`, falling
 * back to a bare `<Outlet/>` when neither is set) renders nothing extra,
 * exactly matching old app's `<Route path=":version" element={<></>} />`.
 * `$agentId`'s own component reads `useParams()` including `version`.
 */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/agents/$tab/$agentId/$version')({});
