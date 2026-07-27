/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Project, ProjectContext, ProjectStatus } from './model/types';
export { isPublicProject, isSuspendedProject, sortProjectsByName } from './model/selectors';
