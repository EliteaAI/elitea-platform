/**
 * Shared type definitions for the interactive-tours feature.
 */

/**
 * A single step in an interactive tour. Mirrors the legacy `TourStep` shape
 * used across the old app without importing Redux-specific types.
 */
export interface TourStep {
  /** Unique identifier for this step (for analytics, etc.). */
  id: string;
  /** CSS selector or data-tour attribute that pinpoints the DOM target. */
  target: string;
  /** Where the card should appear relative to the target. */
  placement?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  /** Whether this step should be skipped (e.g. no visible target element). */
  skip?: boolean;
  /** Step title displayed in the card header. */
  title: string;
  /** Markdown content rendered in the card body. */
  content: string;
  /** Zero-based tab index to switch the active tab before measuring the target. */
  tabIndex?: number;
  /** Scroll block preference when scrolling the target into view. */
  scrollBlock?: 'start' | 'center' | 'end' | 'nearest';
}

/**
 * The `keepExploring` items rendered in the tour-complete card.
 */
export interface KeepExploringItem {
  label: string;
  tourId: string;
  path?: string;
}

/**
 * Shape of the per-tour completion config.
 */
export interface TourCompletionConfig {
  keepExploring: KeepExploringItem[];
}
