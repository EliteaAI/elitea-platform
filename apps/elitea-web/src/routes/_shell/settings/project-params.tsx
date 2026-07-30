/** ROUTE-055 `/settings/project-params` -> `ProjectContextSettings`. */
import { createFileRoute } from '@tanstack/react-router';

import { RouteError, RoutePending } from '@/routes/-ui/RouteStatus';
import { ProjectContextContent } from '@/routes/_shell/settings/project-context/ProjectContextContent';
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

  return <ProjectContextContent projectId={projectId} projectName={projectName} />;
}
