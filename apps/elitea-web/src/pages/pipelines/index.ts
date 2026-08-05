/**
 * pages/pipelines — route targets for ROUTE-017..020/069 (spec §8.1).
 *
 * Spec §3.3's "index.ts is the only import path" rule applies to
 * `processes/`/`features/`/`entities/`/`widgets/` slices, not `pages/`
 * (route files import a page directly by path — same convention
 * `pages/agents/index.ts`, Wave-2 unit A1g, already established). This
 * barrel exists purely as a convenience surface for whoever wires these
 * into `src/routes/**` (outside this unit's ownership fence).
 */
export { Pipelines } from './Pipelines';
export { CreatePipeline } from './CreatePipeline';
export { EditPipeline } from './EditPipeline';
