/**
 * ROUTE-039 `/apps/:tab` -> `Apps` (covers `/apps/applications` and
 * `/apps/catalog` — `AppsTabs = ['applications', 'catalog']`; those two
 * literal values are declared-only `RouteDefinitions` entries superseded
 * by this pattern, per `uictl`'s `declaredOnlyExempt`). Query params
 * PARAM-022/023 `view` — inherited by `$tab/$appId` (no additions).
 */
import { createFileRoute } from '@tanstack/react-router';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/apps/$tab')({
  validateSearch: pickParams('view'),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <ExclusiveOutlet>
      <RouteShell routeId="apps.tab" fallback="Apps" />
    </ExclusiveOutlet>
  ),
});
