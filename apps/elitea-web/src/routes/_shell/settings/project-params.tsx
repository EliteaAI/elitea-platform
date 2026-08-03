/** ROUTE-055 `/settings/project-params` -> `ProjectContextSettings`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { ProjectContext } from '@/pages/settings/ProjectContext';
import { useSelectedProjectStore } from '@/widgets/app-shell';

export const Route = createFileRoute('/_shell/settings/project-params')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: ProjectParamsPage,
});

function ProjectParamsPage() {
  const project = useSelectedProjectStore((s) => s.project);
  const projectId = project?.id ?? '';
  const projectName = project?.name ?? '';

  if (!projectId) {
    return <RoutePending />;
  }

  return <ProjectContext projectId={projectId} projectName={projectName} />;
}
