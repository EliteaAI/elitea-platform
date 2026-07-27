/** ROUTE-021 `/credentials` -> index redirect to the first Credentials tab (`CredentialsTabs = ['all']`). */
import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_shell/credentials/')({
  beforeLoad: () => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's beforeLoad redirect contract: throw the Response redirect() returns, not an Error (verified against the installed @tanstack/router-core's own redirect() implementation).
    throw redirect({ to: '/credentials/$tab', params: { tab: 'all' } });
  },
});
