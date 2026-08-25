/**
 * The right-hand rail of the entity-list pages (`EntityRail.tsx`'s module
 * doc records why it lives in `shared/ui` — briefly: `features/toolkits`
 * and `pages/**` both need it, and `shared/` is the only layer both may
 * import under `.dependency-cruiser.cjs`).
 */
export { EntityRail, RAIL_CONTENT_WIDTH, RAIL_WIDTH_PX, isEntityRailVisible, useEntityRailVisible } from './EntityRail';
/** @public */
export type { EntityRailProps } from './EntityRail';

export { EntityListRail } from './EntityListRail';
/** @public */
export type { EntityListRailProps } from './EntityListRail';

export { RailTagsPanel, RailTagsPanelView } from './RailTagsPanel';
/** @public */
export type { RailTagsPanelProps, RailTagsPanelViewProps } from './RailTagsPanel';

export { RailAuthorCard, RailAuthorCardView, shouldShowAuthorCard } from './RailAuthorCard';
/** @public */
export type { RailAuthorCardProps, RailAuthorCardViewProps } from './RailAuthorCard';

export { RailTrendingAuthors, RailTrendingAuthorsView } from './RailTrendingAuthors';
/** @public */
export type { RailTrendingAuthor, RailTrendingAuthorsProps, RailTrendingAuthorsViewProps } from './RailTrendingAuthors';

export { sortTagsSelectedFirst, toggleTagName } from './lib/railTags';
/** @public */
export type { RailTag } from './lib/railTags';

export { railStatForKind, railStatForPath, railStatRoutePrefixes, resolveRailStat } from './lib/railStatistics';
/** @public */
export type { RailAuthorCounts, RailStatDescriptor, RailStatKind, RailStatValues } from './lib/railStatistics';

export { selectRailViewer, useRailTagSelection, useRailViewer } from './useRailContext';
/** @public */
export type { RailTagSelection, RailViewer } from './useRailContext';
