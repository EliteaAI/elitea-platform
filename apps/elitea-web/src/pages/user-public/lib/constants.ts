/**
 * Local constants for the ROUTE-041 `/user-public/:tab` screen (unit A12).
 *
 * `UserPublicTabValue`/`UserPublicTabs` themselves already live in
 * `shared/lib/tabs.ts` (unit S3, ported from `constants.js:482-495`) — not
 * redeclared here, just re-exported for this slice's own convenience.
 */
import { UserPublicTabs } from '@/shared/lib/tabs';

export { UserPublicTabs } from '@/shared/lib/tabs';
export type UserPublicTabValue = (typeof UserPublicTabs)[number];

/**
 * `apps/elitea-ui/src/hooks/users/usePermissions.jsx:8-10` —
 * `publicAdminPermissions.agents`. This exact permission string does not
 * appear anywhere in `shared/lib/permissions.ts`'s `PERMISSIONS` catalogue
 * (that file's `PERMISSIONS.applications.list` is the DIFFERENT string
 * `'models.applications.public_applications.list'` — verified by reading
 * both files side by side, not assumed). Declared locally rather than
 * reaching into `shared/lib` to add a second, differently-scoped
 * "applications list" permission constant outside this unit's ownership
 * fence.
 */
export const AGENTS_TAB_ADMIN_PERMISSION = 'models.applications.applications.list';
