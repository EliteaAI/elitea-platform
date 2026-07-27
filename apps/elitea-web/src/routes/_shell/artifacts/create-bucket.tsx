/** ROUTE-049 `/artifacts/create-bucket` -> `CreateBucket` (spec §8.1). */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';

export const Route = createFileRoute('/_shell/artifacts/create-bucket')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="artifacts.create-bucket" fallback="Create Bucket" />,
});
