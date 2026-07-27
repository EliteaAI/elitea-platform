/**
 * ROUTE-029 `/toolkits/:tab` -> `Toolkits`. Query params PARAM-094/096/098/
 * 100/102/104/106 (`destTab`, `edited_participant_id`, `forceCustom`,
 * `name`, `newToolkitId`, `return_url`, `source_application_id`) —
 * inherited by `$tab/$toolkitId` (adds `index_name`, the indexes panel —
 * PARAM-047/070).
 */
import { createFileRoute } from '@tanstack/react-router';

import { ExclusiveOutlet } from '../../-ui/ExclusiveOutlet';
import { RouteError, RoutePending } from '../../-ui/RouteStatus';
import { RouteShell } from '../../-ui/RouteShell';
import { pickParams } from '../../-search/params';

export const Route = createFileRoute('/_shell/toolkits/$tab')({
  validateSearch: pickParams(
    'destTab',
    'edited_participant_id',
    'forceCustom',
    'name',
    'newToolkitId',
    'return_url',
    'source_application_id',
  ),
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: () => (
    <ExclusiveOutlet>
      <RouteShell routeId="toolkits.tab" fallback="Toolkits" />
    </ExclusiveOutlet>
  ),
});
