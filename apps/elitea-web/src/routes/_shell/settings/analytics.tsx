/**
 * ROUTE-060 `/settings/analytics` — analytics dashboard.
 *
 * Wires up the fully implemented `AnalyticsContainer` (features/analytics)
 * to the settings route, supplying `projectId`/`projectName` from the
 * `useSelectedProjectStore` (widgets/app-shell).
 */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { AnalyticsContainer } from '@/features/analytics';
import { useSelectedProjectStore } from '@/widgets/app-shell';

export const Route = createFileRoute('/_shell/settings/analytics')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const project = useSelectedProjectStore((s) => s.project);
  const projectId = project?.id;

  if (!project?.name) {
    return <AnalyticsContainer projectId={projectId} />;
  }

  return <AnalyticsContainer projectId={projectId} projectName={project.name} />;
}
