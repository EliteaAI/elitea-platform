/**
 * One wiki toolkit's browser, shared by `/deepwiki` and `/deepwiki/$toolkitId`.
 *
 * A `-`-prefixed directory, so the router does not treat it as a route. Both
 * entry points resolve a toolkit and then render exactly the same thing, and a
 * second copy of that resolution is a second place for the error branches to
 * drift.
 */
import { useWikiToolkit } from '@/entities/wiki';
import { DeepWiki } from '@/pages/deepwiki/DeepWiki';
import { t } from '@/shared/i18n';

import { RoutePending } from '../../-ui/RouteStatus';

export interface DeepWikiToolkitBodyProps {
  readonly projectId: string;
  readonly toolkitId: string;
}

export function DeepWikiToolkitBody({
  projectId,
  toolkitId,
}: DeepWikiToolkitBodyProps): React.JSX.Element {
  const query = useWikiToolkit(projectId, toolkitId);

  if (query.isPending) return <RoutePending />;

  // A toolkit that cannot be read is NOT an empty wiki list. Rendering the
  // browser here would say "this repository has no wikis" about a repository
  // this screen never learned the name of.
  if (query.isError) {
    return (
      <p data-testid="deepwiki-toolkit-error">
        {t(
          'deepwiki.toolkitFailed',
          'This wiki toolkit could not be loaded, so its wikis cannot be listed.',
        )}
      </p>
    );
  }

  return (
    <DeepWiki
      projectId={projectId}
      identity={query.data.identity}
      toolkitId={toolkitId}
      settings={query.data.settings}
    />
  );
}
