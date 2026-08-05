import type { ReactNode } from 'react';

import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { t } from '@/shared/i18n';

/**
 * Ported from `apps/elitea-ui/src/pages/Applications/MyLiked.jsx` — the
 * "public applications I've liked" tab, baseline-backed by
 * `usePublicApplicationsListQuery({..., my_liked: true})`.
 *
 * **Composition gap, not a placeholder — real backend contract absence:**
 * `ListPublicApplicationsParams` (`shared/api/generated/model/
 * listPublicApplicationsParams.zod.ts`) has exactly one field, `category`.
 * The Go handler behind it (`internal/api/v2/eliteacore/handler.go:
 * 1251-1317`) never reads a `my_liked` flag, and no other generated
 * endpoint exposes "applications the current user liked" at all (grepped
 * `shared/api/generated/**` for `liked`/`like` — the only hits are the
 * per-application `Like`/`Unlike` action endpoints, not a list filter).
 * Silently rendering `Latest`'s full unfiltered feed under a "My liked"
 * label would misrepresent an unimplemented filter as a working one — this
 * renders an explicit, disclosed empty state instead (same posture
 * `pages/apps/Apps.tsx`'s own `data-testid="apps-applications-tab-panel"`
 * gap already established for this codebase), keyed for tests via
 * `data-testid="agents-my-liked-unavailable"`.
 */
export function MyLiked(): ReactNode {
  return (
    <div data-testid="agents-my-liked-unavailable">
      <NoResultsMessage
        title={t('pages.agents.myLiked.unavailable.title', 'Liked agents are not available yet.')}
        description={t(
          'pages.agents.myLiked.unavailable.description',
          'The public agents API does not yet support filtering by liked status.',
        )}
      />
    </div>
  );
}
