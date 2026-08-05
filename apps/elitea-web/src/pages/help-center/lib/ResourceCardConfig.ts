/**
 * Hardcoded fallback configurations for resource cards.
 *
 * KEY DECISION #2 (issue #26): the Go endpoints
 * `GET /admin/system_info/prompt_lib` and
 * `GET /admin/plugin_config_values/prompt_lib/resources` exist but lack
 * OpenAPI specs in the new app. **Render page using these hardcoded
 * defaults — do NOT fake network calls.** Document the gap above.
 *
 * These values match the old `resources/index.jsx` baseline exactly.
 * They are the source-of-truth when the admin config endpoints are not
 * available or return empty.
 *
 * See `./useResourcesConfig.ts` for the full explanation of the API gap
 * and exactly what unblocks it.
 */

import type { ResourceCardConfig } from './ResourceCard.types';

// Icon imports — shared/ui icons that already exist in the new app.
// The old app imports from `@/assets/*.svg?react`; these are Wave-1
// equivalents available at shared/ui/icons/.
import { FileIcon } from '@/shared/ui/icons/file-icon';
import { RocketIcon } from '@/shared/ui/icons/rocket-icon';
import { TutorialsIcon } from '@/shared/ui/icons/tutorials-icon';
import { VideoIcon } from '@/shared/ui/icons/video-icon';

// Tour target ids — ported from interactive-tours constants (already built).
import { RESOURCES_TOUR_TARGET_IDS } from '@/features/interactive-tours';

/** Default resource card configurations consumed by the HelpCenterPage. */
export const RESOURCE_CARD_CONFIGS: ReadonlyArray<ResourceCardConfig> = [
  {
    enabledKey: 'resources_documentation_enabled',
    titleKey: 'resources_documentation_title',
    descriptionKey: 'resources_documentation_description',
    defaultTitle: 'Documentation',
    defaultDescription: 'API reference, guides, and platform concepts',
    Icon: FileIcon,
    linksKey: 'resources_documentation_links',
    colorScheme: 'blue',
    tourTargetId: RESOURCES_TOUR_TARGET_IDS.documentationCard,
  },
  {
    enabledKey: 'resources_release_notes_enabled',
    titleKey: 'resources_release_notes_title',
    descriptionKey: 'resources_release_notes_description',
    defaultTitle: 'Release Notes',
    defaultDescription: 'Product updates, improvements, and fixes',
    Icon: RocketIcon,
    linksKey: 'resources_release_notes_links',
    colorScheme: 'orange',
    tourTargetId: RESOURCES_TOUR_TARGET_IDS.releaseNotesCard,
  },
  {
    enabledKey: 'resources_video_library_enabled',
    titleKey: 'resources_video_library_title',
    descriptionKey: 'resources_video_library_description',
    defaultTitle: 'Video Library',
    defaultDescription: 'Product walkthroughs and recorded sessions',
    Icon: VideoIcon,
    linksKey: 'resources_video_library_links',
    colorScheme: 'purple',
    tourTargetId: RESOURCES_TOUR_TARGET_IDS.videoLibraryCard,
  },
  {
    enabledKey: 'resources_tutorials_enabled',
    titleKey: 'resources_tutorials_title',
    descriptionKey: 'resources_tutorials_description',
    defaultTitle: 'Tutorials',
    defaultDescription: 'Step-by-step guides and use cases',
    Icon: TutorialsIcon,
    linksKey: 'resources_tutorials_links',
    colorScheme: 'green',
    tourTargetId: RESOURCES_TOUR_TARGET_IDS.tutorialsCard,
  },
  {
    enabledKey: 'resources_interactive_tours_enabled',
    titleKey: 'resources_interactive_tours_title',
    descriptionKey: 'resources_interactive_tours_description',
    defaultTitle: 'Interactive Tours',
    defaultDescription: 'Guided tours to explore key features and workflows',
    Icon: VideoIcon,
    linksKey: 'resources_interactive_tours_links',
    colorScheme: 'pink',
    tourTargetId: RESOURCES_TOUR_TARGET_IDS.interactiveToursCard,
  },
];
