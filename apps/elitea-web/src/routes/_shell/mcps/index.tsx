/**
 * ROUTE-031 `/mcps` -> index redirect to the first Toolkits tab (old app:
 * `getIndexElement(ToolkitsTabs[0])`, same list `<Toolkits isMCP/>` reads).
 * Hidden by `mcp_exposure_enabled`/`mcp_in_menu_enabled` platform flags
 * (spec §8.1 note) — a Wave-2/sidebar-widget visibility concern
 * (`useMcpVisibility.hooks.js`), not a route-level guard: the route itself
 * still resolves identically, it is just not linked-to from a hidden
 * sidebar entry, exactly like `/mcp-auth-callback` has no guard either.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/mcps/')({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/mcps/$tab', params: { tab: 'all' } });
  },
});
