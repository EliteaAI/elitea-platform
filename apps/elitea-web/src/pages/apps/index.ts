/**
 * pages/apps — route targets for ROUTE-036..040 (and ROUTE-046, rendered
 * by the same `AppDetail` — see that file's doc comment).
 *
 * Spec §3.3's "index.ts is the only import path" rule applies to
 * `processes/`/`features/`/`entities/`/`widgets/` slices, not `pages/`
 * (route files import a page directly by path). This barrel exists purely
 * as a convenience surface for whoever wires these into `src/routes/**`
 * (outside this unit's ownership fence).
 */
export { AppDetail } from './AppDetail';
export { Apps } from './Apps';
