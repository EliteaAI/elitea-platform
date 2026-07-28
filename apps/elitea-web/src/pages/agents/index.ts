/**
 * pages/agents — route targets for ROUTE-009..012/067 (spec §8.1).
 *
 * Spec §3.3's "index.ts is the only import path" rule applies to
 * `processes/`/`features/`/`entities/`/`widgets/` slices, not `pages/`
 * (route files import a page directly by path — same convention `pages/
 * apps/index.ts` already established). This barrel exists purely as a
 * convenience surface for whoever wires these into `src/routes/**` (outside
 * this unit's ownership fence).
 */
export { Applications } from './Applications';
export { CreateApplication } from './CreateApplication';
export { EditApplication } from './EditApplication';
