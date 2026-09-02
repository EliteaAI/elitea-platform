/**
 * DWIKI-001 `/deepwiki` -> `DeepWiki`.
 *
 * The route is MOUNTED while `BackendCapability.deepwiki` is off, and the page
 * renders nothing in that state. Mounting it now is what makes every
 * intermediate change shippable: the route exists, its code splits, and the
 * screen is blank rather than broken. See the page's own header for why the
 * capability is off — it is the provider's write path, not this feature.
 */
import { createFileRoute } from '@tanstack/react-router';

import { DeepWiki } from '@/pages/deepwiki/DeepWiki';

import { RouteError, RoutePending } from '../-ui/RouteStatus';

export const Route = createFileRoute('/_shell/deepwiki')({
  pendingComponent: RoutePending,
  errorComponent: RouteError,
  component: DeepWikiRoute,
});

function DeepWikiRoute(): React.JSX.Element {
  // The project and the configured repository both arrive with the settings
  // work (DWIKI-010). Until then the route renders the page in its
  // capability-off state, which is null.
  return <DeepWiki projectId="" identity={null} />;
}
