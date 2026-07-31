/**
 * Port of `apps/elitea-ui/src/[fsd]/features/interactive-tours/lib/helpers/tourSelector.helpers.js`
 */

/**
 * Builds a CSS selector string from a raw target ID, wrapping it in a
 * `data-tour` attribute selector that the legacy app uses to identify
 * tour targets.
 *
 * Consumers can also use arbitrary selectors (e.g. `#id`, `.class`) —
 * this helper is provided as a convenience for the data-tour convention.
 */
export const buildTourSelector = (targetId: string): string => `[data-tour="${targetId}"]`;
