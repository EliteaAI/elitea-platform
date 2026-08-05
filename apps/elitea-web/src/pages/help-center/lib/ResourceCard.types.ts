/**
 * TypeScript types for the help-center ResourceCard component.
 * Ported from `apps/elitea-ui/src/[fsd]/pages/resources/ui/ResourceCard.jsx`.
 */

import type { ReactNode } from 'react';

/** Named color schemes matching the `resourceCard` palette tokens. */
type ResourceColorScheme = 'blue' | 'orange' | 'purple' | 'green' | 'pink';

/** Configuration entry for a single resource card. */
export interface ResourceCardConfig {
  /** Unique key used for React `key` and to look up config values from the API response. */
  readonly enabledKey: string;
  /** i18n / API key for the card title. */
  readonly titleKey: string;
  /** i18n / API key for the card description. */
  readonly descriptionKey: string;
  /** Shown when the API has not yet returned a title. */
  readonly defaultTitle: string;
  /** Shown when the API has not yet returned a description. */
  readonly defaultDescription: string;
  /** MUI icon element rendered in the card header. */
  readonly Icon: React.ComponentType<{ width?: string; height?: string }>;
  /** API key for the card's link array. */
  readonly linksKey: string;
  /** Color scheme token mapped to `resourceCard.<scheme>` palette entries. */
  readonly colorScheme: ResourceColorScheme;
  /** Tour target id consumed by the interactive-tours feature. */
  readonly tourTargetId: string;
}

/** Props passed to the ResourceCard component. */
export interface ResourceCardProps {
  title: string;
  description: string;
  colorScheme: ResourceColorScheme;
  tourTargetId: string;
  /** Icon element rendered in the card header. */
  icon: ReactNode;
  /** Children — typically link items or a "no links" message. */
  children: ReactNode;
}
