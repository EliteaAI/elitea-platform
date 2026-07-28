import type { ReactNode } from 'react';

import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/Trending.jsx` — the
 * "trending in the last N days" tab, baseline-backed by
 * `usePublicApplicationsListQuery({..., trend_start_period: trendRange,
 * agents_type: 'pipeline'})` and a `DateRangeSelect`/`useTrendRange` range
 * picker rendered by `Pipelines.jsx`'s toolbar.
 *
 * **Composition gap, not a placeholder — real backend contract absence**,
 * same one `pages/agents/Trending.tsx` (Wave-2 unit A1g) documents:
 * `ListPublicApplicationsParams` has exactly one field, `category` — no
 * `trend_start_period` or any other time-window filter exists on this
 * endpoint's contract (`internal/api/v2/eliteacore/handler.go:1251-1307`),
 * and there is no `DateRangeSelect` port anywhere in `shared/ui` either.
 * Rendering `Latest`'s (pipeline-filtered) feed under a "Trending" label
 * with no actual time-window applied would misrepresent an unimplemented
 * filter as working — this renders an explicit, disclosed empty state
 * instead, same posture as `MyLiked.tsx` (this unit).
 * `data-testid="pipelines-trending-unavailable"`.
 */
export function Trending(): ReactNode {
  return (
    <div data-testid="pipelines-trending-unavailable">
      <NoResultsMessage
        title={t('pages.pipelines.trending.unavailable.title', 'Trending pipelines are not available yet.')}
        description={t(
          'pages.pipelines.trending.unavailable.description',
          'The public pipelines API does not yet support filtering by a trending time window.',
        )}
      />
    </div>
  );
}
