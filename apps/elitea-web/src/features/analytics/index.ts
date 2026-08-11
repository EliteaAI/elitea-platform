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

/**
 * Added by unit A14: `pages/admin/AuditTrailFilters.tsx` needs the same
 * From/To range control, including the fix this component carries for the
 * `DateTimePicker`'s silently-dead "Clear" button. Promoted to the slice's
 * public API rather than deep-imported from `./ui/components/` (§3.3), and
 * rather than copied — a second copy is a second place for that fix to be
 * missing. Still 4 of the ≤20 export budget.
 */
export { DateRangeField } from './ui/components/DateRangeField';
export type { DateRangeFieldProps } from './ui/components/DateRangeField';
