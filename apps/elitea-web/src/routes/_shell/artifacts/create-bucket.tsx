/** ROUTE-049 `/artifacts/create-bucket` -> `CreateBucket` (spec §8.1). */
import { createFileRoute } from '@tanstack/react-router';

import { CreateBucket } from '@/pages/artifacts/CreateBucket';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/artifacts/create-bucket')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: CreateBucket,
});
