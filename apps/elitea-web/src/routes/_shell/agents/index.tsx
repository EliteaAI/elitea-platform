/**
 * ROUTE-009 `/agents` -> index redirect to the first Applications tab
 * (old app: `getIndexElement(ApplicationsTabs[0])`,
 * `ApplicationsTabs = ['latest', 'my-liked', 'trending', 'admin']`,
 * `common/constants.js:483`).
 *
 * `agents/index.tsx` (not `agents.tsx`) is deliberate: verified against the
 * installed `@tanstack/router-generator@1.168.23` that an `index.tsx` file
 * does NOT become the structural parent of sibling files in the same
 * directory (`agents/create.tsx`, `agents/$tab.tsx`, ...) — only a literal
 * `route.tsx` (or a flat `agents.tsx`) would. Old app's `/agents`,
 * `/agents/create`, `/agents/:tab` are three independent sibling routes
 * (`ProtectedRoutes.jsx`'s flat array), and this reproduces that shape
 * exactly instead of accidentally nesting them.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/agents/')({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/agents/$tab', params: { tab: 'latest' } });
  },
});
