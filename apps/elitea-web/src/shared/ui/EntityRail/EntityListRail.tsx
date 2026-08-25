import type { ReactNode } from 'react';

import { useLocation } from '@tanstack/react-router';

import { EntityRail } from './EntityRail';
import { RailAuthorCard, shouldShowAuthorCard } from './RailAuthorCard';
import { RailTagsPanel } from './RailTagsPanel';
import { RailTrendingAuthors } from './RailTrendingAuthors';
import { useRailTagSelection, useRailViewer } from './useRailContext';
import type { RailStatKind } from './lib/railStatistics';

/**
 * The whole rail, composed the way `components/CardList.jsx:96` composes it
 * in the baseline: `RightPanel` (geometry + search slot) wrapping
 * `RightInfoPanel` (`Categories` + either `AuthorInformation` or
 * `TeamMates`).
 *
 * Every list page renders exactly this one element. The two decisions the
 * baseline makes inside `RightInfoPanel.jsx:25-33` — author card vs trending
 * authors — are made here from the same three inputs (URL `author_id`, the
 * selected project, the viewer's personal project), with
 * `preferTrendingAuthors` as the explicit override for the two places the
 * baseline hard-codes trending authors regardless: the public feeds and the
 * agents/pipelines Admin tab (`pages/Applications/PrivateAgentsList.jsx:
 * 141-151`).
 */
export interface EntityListRailProps {
  /** The project the tag list and the trending-author ranking are scoped to. */
  readonly projectId: string | undefined;
  /** The route's `author_id` search param, when the page has one (user-public does). Drives BOTH which panel shows and whose detail is fetched. */
  readonly authorIdFromUrl?: string;
  /** Forces the "Trending Authors" panel — the public feeds and the Admin tab. */
  readonly preferTrendingAuthors?: boolean;
  /** Overrides the pathname-prefix statistic lookup — for `/user-public/:tab`, whose prefix names no entity while its tab does. */
  readonly statKind?: RailStatKind;
  /** The page's own search bar, hoisted into the rail (the baseline's `RightPanel` renders it above the tags panel). */
  readonly search?: ReactNode;
  readonly navRailCollapsed?: boolean;
  readonly indexesTotal?: number;
}

export function EntityListRail({
  projectId,
  authorIdFromUrl,
  preferTrendingAuthors = false,
  statKind,
  search,
  navRailCollapsed = false,
  indexesTotal,
}: EntityListRailProps): ReactNode {
  const location = useLocation();
  const tagSelection = useRailTagSelection();
  const viewer = useRailViewer(authorIdFromUrl);
  const showAuthor = !preferTrendingAuthors && shouldShowAuthorCard(authorIdFromUrl, projectId, viewer.personalProjectId);

  return (
    <EntityRail
      navRailCollapsed={navRailCollapsed}
      {...(search === undefined ? {} : { search })}
    >
      <RailTagsPanel
        projectId={projectId}
        selectedTags={tagSelection.selectedTags}
        onToggleTag={tagSelection.toggleTag}
        onClearTags={tagSelection.clearTags}
      />
      {showAuthor ? (
        <RailAuthorCard
          authorId={viewer.authorId}
          pathname={location.pathname}
          {...(statKind === undefined ? {} : { statKind })}
          {...(indexesTotal === undefined ? {} : { indexesTotal })}
        />
      ) : (
        <RailTrendingAuthors projectId={projectId} />
      )}
    </EntityRail>
  );
}
