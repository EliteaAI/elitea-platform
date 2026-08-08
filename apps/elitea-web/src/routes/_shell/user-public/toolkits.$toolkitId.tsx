/** ROUTE-044 `/user-public/toolkits/:toolkitId` -> `EditToolkit`. */
import { createFileRoute } from '@tanstack/react-router';

import { EditToolkit } from '@/pages/toolkits/EditToolkit';

import { RouteError, RoutePending } from '../../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/user-public/toolkits/$toolkitId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: EditToolkitRoute,
});

function EditToolkitRoute() {
  return <EditToolkit />;
}
