/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 *
 * ROUTE-060 (`/settings/analytics`) renders `AnalyticsContainer`; this
 * slice has no `pages/analytics/` split (confirmed against
 * `parity/wave2-partition.json`'s A10 entry: `ownedPaths` is exactly
 * `src/features/analytics/`) — whoever wires the route composes this
 * component directly, supplying `projectId`/`projectName` (see
 * `AnalyticsContainer`'s own doc comment for why those are injected props,
 * not internally resolved).
 */
export { AnalyticsContainer } from './ui/AnalyticsContainer';
export type { AnalyticsContainerProps } from './ui/AnalyticsContainer';
