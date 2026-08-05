import type { ReactNode } from 'react';

import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { t } from '@/shared/i18n';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/Trending.jsx` — the
 * "trending in the last N days" tab, baseline-backed by
 * `usePublicApplicationsListQuery({..., trend_start_period: trendRange})`
 * and a `DateRangeSelect`/`useTrendRange` range picker rendered by
 * `Applications.jsx`'s toolbar.
 *
 * **Composition gap, not a placeholder — real backend contract absence:**
 * `ListPublicApplicationsParams` has exactly one field, `category` — no
 * `trend_start_period` or any other time-window filter exists on this
 * endpoint's contract (`internal/api/v2/eliteacore/handler.go:1251-1317`),
 * and there is no `DateRangeSelect` port anywhere in `shared/ui` either.
 * Rendering `Latest`'s full feed under a "Trending" label with no actual
 * time-window applied would misrepresent an unimplemented filter as
 * working — this renders an explicit, disclosed empty state instead, same
 * posture as `MyLiked.tsx` (this unit) and `pages/apps/Apps.tsx`'s own
 * composition-gap precedent. `data-testid="agents-trending-unavailable"`.
 */
export function Trending(): ReactNode {
  return (
    <div data-testid="agents-trending-unavailable">
      <NoResultsMessage
        title={t('pages.agents.trending.unavailable.title', 'Trending agents are not available yet.')}
        description={t(
          'pages.agents.trending.unavailable.description',
          'The public agents API does not yet support filtering by a trending time window.',
        )}
      />
    </div>
  );
}
