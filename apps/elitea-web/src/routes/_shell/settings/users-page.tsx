/**
 * Users settings page — manages project members: list, invite, edit roles, delete.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/pages/settings/Users.jsx`.
 *
 * Deviations from the baseline:
 *  - Uses MUI DataGrid instead of the FSD GridTable custom component.
 *  - Search is client-side (API returns all rows within limit).
 *  - Permissions gating removed.
 *  - Tour IDs (`data-tour`) dropped.
 *  - Uses `useTheme()` + `theme.vars.palette.*` for styling.
 *  - Uses `t()` from `@/shared/ui/lib/t` for i18n.
 *  - Debounced search via custom hook.
 *  - Actions/mutations extracted to `useUsersActions` to keep ≤ 400 lines.
 *
 * Implementation split to stay under the max-lines lint limit:
 *  - `UsersPage.tsx` — data hooks (`useUsersPageData`, `useUsersPageCallbacks`)
 *    and the `UsersPage` component that wires everything together.
 *  - `UsersPageContent.tsx` — the UI rendering (search bar, table, pagination,
 *    dialogs) as a presentational component.
 *  - This file is the public entry point.
 */

export { UsersPage, type UsersPageProps } from './UsersPage';
