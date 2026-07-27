/**
 * ROUTE-022 `/credentials/:tab` -> `Credentials`. Query params
 * PARAM-037/039/041/043/045 (`forceCustom`, `from`, `prefill_id`,
 * `prefill_name`, `section`) — inherited by `$tab/:credential_uid`
 * (PARAM-038/040/042/044/046 declare the identical set, no additions).
 */
import { createFileRoute } from '@tanstack/react-router';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/credentials/$tab')({
  validateSearch: pickParams('forceCustom', 'from', 'prefill_id', 'prefill_name', 'section'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <ExclusiveOutlet>
      <RouteShell routeId="credentials.tab" fallback="Credentials" />
    </ExclusiveOutlet>
  ),
});
