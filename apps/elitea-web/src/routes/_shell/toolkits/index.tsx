/** ROUTE-026 `/toolkits` -> index redirect to the first Toolkits tab (`ToolkitsTabs = ['all', 'my-liked', 'trending', 'admin']`). */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/toolkits/')({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/toolkits/$tab', params: { tab: 'all' } });
  },
});
