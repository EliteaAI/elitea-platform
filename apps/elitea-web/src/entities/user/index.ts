/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Role, User, UserPage } from './model/types';
export { sortUsersByName, userHasRole, userInitials } from './model/selectors';
