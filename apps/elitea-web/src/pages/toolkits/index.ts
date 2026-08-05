/**
 * pages/toolkits — route targets for ROUTE-026..030 (and the `/mcps/**`
 * siblings — `EditToolkit`/`CreateToolkit` both render either surface via
 * their own `isMCP` prop, matching the baseline's identical single-component
 * reuse; see each file's own doc comment).
 *
 * Spec §3.3's "index.ts is the only import path" rule applies to
 * `processes/`/`features/`/`entities/`/`widgets/` slices, not `pages/`
 * (route files import a page directly by path). This barrel exists purely
 * as a convenience surface for whoever wires these into `src/routes/**`
 * (outside this unit's ownership fence).
 */
export { CreateToolkit } from './CreateToolkit';
export type { CreateToolkitDeps, CreateToolkitProps } from './CreateToolkit';
export { EditToolkit } from './EditToolkit';
export type { EditToolkitDeps, EditToolkitProps } from './EditToolkit';
export { Toolkits } from './Toolkits';
export type { ToolkitsProps } from './Toolkits';
