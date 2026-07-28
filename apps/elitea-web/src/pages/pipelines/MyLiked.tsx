import type { ReactNode } from 'react';

import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/MyLiked.jsx` — the
 * "public pipelines I've liked" tab, baseline-backed by
 * `usePublicApplicationsListQuery({..., my_liked: true, agents_type:
 * 'pipeline'})`.
 *
 * **Composition gap, not a placeholder — real backend contract absence**,
 * same one `pages/agents/MyLiked.tsx` (Wave-2 unit A1g) documents:
 * `ListPublicApplicationsParams` (`shared/api/generated/model/
 * listPublicApplicationsParams.zod.ts`) has exactly one field, `category`.
 * The Go handler behind it (`internal/api/v2/eliteacore/handler.go:
 * 1251-1307`) never reads a `my_liked` flag, and no other generated endpoint
 * exposes "applications the current user liked" at all (grepped
 * `shared/api/generated/**` for `liked`/`like` — the only hits are the
 * per-application `Like`/`Unlike` action endpoints, not a list filter).
 * Silently rendering `Latest`'s (pipeline-filtered) feed under a "My liked"
 * label would misrepresent an unimplemented filter as a working one — this
 * renders an explicit, disclosed empty state instead, keyed for tests via
 * `data-testid="pipelines-my-liked-unavailable"`.
 */
export function MyLiked(): ReactNode {
  return (
    <div data-testid="pipelines-my-liked-unavailable">
      <NoResultsMessage
        title={t('pages.pipelines.myLiked.unavailable.title', 'Liked pipelines are not available yet.')}
        description={t(
          'pages.pipelines.myLiked.unavailable.description',
          'The public pipelines API does not yet support filtering by liked status.',
        )}
      />
    </div>
  );
}
