/**
 * ROUTE-048 `/artifacts` -> `Artifacts` (spec §8.1: "requires
 * `artifacts.view`" — the P8 fix, task item 4; PERM-003
 * `configuration.artifacts.artifacts.view`). Query params PARAM-024..027
 * (`bucket`, `file`, `folder`, `shared_bucket` — spec QP-009). `index.tsx`
 * keeps `/artifacts/create-bucket` an independent sibling (same
 * non-nesting property as `agents/index.tsx`/`apps/index.tsx`) instead of
 * nesting it under this route, matching old app's flat sibling routes.
 */
import { createFileRoute } from '@tanstack/react-router';

import { requireArtifactsPermission } from '../../-guards/requirePermission';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/artifacts/')({
  validateSearch: pickParams('bucket', 'file', 'folder', 'shared_bucket'),
  beforeLoad: requireArtifactsPermission,
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => <RouteShell routeId="artifacts" fallback="Artifacts" />,
});
