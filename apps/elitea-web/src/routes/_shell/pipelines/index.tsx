/** ROUTE-017 `/pipelines` -> index redirect to the first Applications tab (`ApplicationsTabs[0] = 'latest'`). */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/pipelines/')({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/pipelines/$tab', params: { tab: 'latest' } });
  },
});
