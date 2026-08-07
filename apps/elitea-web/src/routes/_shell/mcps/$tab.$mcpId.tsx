/** ROUTE-035 `/mcps/:tab/:mcpId` -> `EditToolkit isMCP`. */
import { createFileRoute } from '@tanstack/react-router';

import { EditToolkit } from '@/pages/toolkits/EditToolkit';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/mcps/$tab/$mcpId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditToolkitRoute,
});

function EditToolkitRoute() {
  return <EditToolkit isMCP />;
}
