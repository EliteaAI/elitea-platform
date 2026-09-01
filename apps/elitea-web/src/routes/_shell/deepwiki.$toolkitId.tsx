/**
 * DWIKI-001 `/deepwiki/$toolkitId` -> the wiki browser for one toolkit.
 *
 * THE TOOLKIT IS IN THE PATH, and the project is not. That split is the legacy
 * addressing rewritten in this app's terms: the vendored bundle took both out
 * of `/app/ui_host/deepwiki/ui/{project}/{toolkit}`, and here the project is
 * whatever the project switcher has selected — the rule every other `_shell`
 * route follows. A project can hold several wiki toolkits pointed at different
 * repositories, so the toolkit is the wiki's address and cannot be inferred.
 */
import { createFileRoute } from '@tanstack/react-router';

import { hasBackendCapability } from '@/shared/config/backendCapabilities';
import { useSelectedProjectStore } from '@/widgets/app-shell';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { DeepWikiToolkit } from '@/pages/deepwiki/DeepWikiToolkit';

export const Route = createFileRoute('/_shell/deepwiki/$toolkitId')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DeepWikiToolkitRoute,
});

function DeepWikiToolkitRoute(): React.JSX.Element | null {
  const { toolkitId } = Route.useParams();
  const projectId = useSelectedProjectStore((state) => state.project?.id ?? '');

  if (!hasBackendCapability('deepwiki')) return null;
  return <DeepWikiToolkit projectId={projectId} toolkitId={toolkitId} />;
}
