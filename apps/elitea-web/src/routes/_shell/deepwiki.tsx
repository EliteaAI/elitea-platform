/**
 * DWIKI-001 `/deepwiki` — the project's wikis, reached without a URL someone
 * had to be handed.
 *
 * THE LEGACY HAD NO SUCH SCREEN. The vendored bundle is always entered with a
 * toolkit already in its path (`/app/ui_host/deepwiki/ui/{project}/{toolkit}`,
 * DeepWikiApp.jsx:756-788), because pylon's provider hub linked to it. This
 * app has a nav rail instead, so the route has to resolve its own toolkit —
 * and a project can hold several wiki toolkits pointed at different
 * repositories, so it cannot simply guess.
 *
 * Three states, and the middle one is the reason this is not a redirect:
 * exactly one toolkit renders it, several offer the choice, none says so. A
 * redirect on "exactly one" would make the URL depend on how many toolkits a
 * project happens to have, so the browser's Back button would land somewhere
 * different for two projects.
 */
import { createFileRoute, Link } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

import { useWikiToolkits } from '@/entities/wiki';
import { hasBackendCapability } from '@/shared/config/backendCapabilities';
import { t } from '@/shared/i18n';
import { useSelectedProjectStore } from '@/widgets/app-shell';

import { RouteError, RoutePending } from '../-ui/RouteStatus';
import { DeepWikiToolkitBody } from './-deepwiki/DeepWikiToolkitBody';

export const Route = createFileRoute('/_shell/deepwiki')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DeepWikiIndexRoute,
});

function DeepWikiIndexRoute(): React.JSX.Element | null {
  const projectId = useSelectedProjectStore((state) => state.project?.id ?? '');
  const query = useWikiToolkits(projectId);

  if (!hasBackendCapability('deepwiki')) return null;
  if (query.isPending) return <RoutePending />;

  if (query.isError) {
    return (
      <Typography variant="body2" color="error" data-testid="deepwiki-toolkits-error">
        {t('deepwiki.toolkitsFailed', 'The wiki toolkits for this project could not be listed.')}
      </Typography>
    );
  }

  const toolkits = query.data;

  if (toolkits.length === 0) {
    // NOT an empty wiki list. "This project has no wiki toolkit" and "this
    // wiki has no pages" are different facts, and only the first one tells the
    // user what to do next.
    return (
      <Typography variant="body2" data-testid="deepwiki-no-toolkits">
        {t(
          'deepwiki.noToolkits',
          'This project has no wiki toolkit. Add one to generate and browse wikis.',
        )}
      </Typography>
    );
  }

  if (toolkits.length === 1 && toolkits[0]) {
    return <DeepWikiToolkitBody projectId={projectId} toolkitId={toolkits[0].id} />;
  }

  return (
    <Box data-testid="deepwiki-toolkit-chooser">
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('deepwiki.chooseToolkit', 'Choose a wiki')}
      </Typography>
      <List>
        {toolkits.map((toolkit) => (
          // The Link WRAPS the button rather than being its `component`: this
          // app's MUI build does not expose the polymorphic `component` prop on
          // ListItemButton's types, and a plain onClick would lose the middle
          // click and the copyable href a router Link gives for free.
          <Link
            key={toolkit.id}
            to="/deepwiki/$toolkitId"
            params={{ toolkitId: toolkit.id }}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <ListItemButton>
              <ListItemText primary={toolkit.name} />
            </ListItemButton>
          </Link>
        ))}
      </List>
    </Box>
  );
}
