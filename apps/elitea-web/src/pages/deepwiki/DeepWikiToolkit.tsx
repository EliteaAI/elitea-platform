/**
 * One wiki toolkit's browser, shared by `/deepwiki` and `/deepwiki/$toolkitId`.
 *
 * Both entry points resolve a toolkit and then render exactly the same thing,
 * and a second copy of that resolution is a second place for the error branches
 * to drift.
 *
 * IT LIVES HERE AND NOT UNDER `routes/`. TanStack ignores a `-`-prefixed
 * directory, so `routes/_shell/-deepwiki/` was a legal place to hide a non-route
 * — but `scripts/build-route-wiring-map.mjs` walks every file under `src/routes`
 * and counted it as a route, inventing a `-deepwiki` domain with one entry. A
 * component under `routes/` that is not a route confuses more than that one
 * walker, so it moved rather than the walker gaining an exception.
 *
 * It fetches, which a PAGE does not: the rule (spec §3) is that a page owns no
 * ad-hoc fetching, and this uses `entities/wiki`'s own hook, which is the
 * sanctioned shape. Resolving the toolkit is the thing both routes need done
 * before the page can be rendered at all.
 */
import Box from '@mui/material/Box';

import { useWikiToolkit } from '@/entities/wiki';
import { DeepWiki } from '@/pages/deepwiki/DeepWiki';
import { t } from '@/shared/i18n';
import { BannerMessage } from '@/shared/ui/BannerMessage';

import { RoutePending } from '@/routes/-ui/RouteStatus';

export interface DeepWikiToolkitProps {
  readonly projectId: string;
  readonly toolkitId: string;
}

export function DeepWikiToolkit({
  projectId,
  toolkitId,
}: DeepWikiToolkitProps): React.JSX.Element {
  const query = useWikiToolkit(projectId, toolkitId);

  if (query.isPending) return <RoutePending />;

  // A toolkit that cannot be read is NOT an empty wiki list. Rendering the
  // browser here would say "this repository has no wikis" about a repository
  // this screen never learned the name of.
  if (query.isError) {
    return (
      <Box data-testid="deepwiki-toolkit-error" sx={{ p: '1.5rem' }}>
        <BannerMessage
          variant="error"
          message={t(
            'deepwiki.toolkitFailed',
            'This wiki toolkit could not be loaded, so its wikis cannot be listed.',
          )}
        />
      </Box>
    );
  }

  return (
    <DeepWiki
      projectId={projectId}
      identity={query.data.identity}
      toolkitId={toolkitId}
      settings={query.data.settings}
      toolkit={query.data.toolkit as Record<string, unknown>}
    />
  );
}
