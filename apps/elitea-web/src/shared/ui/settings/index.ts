/**
 * Settings shell — thin layout components only.
 *
 * Business-logic components (tables, forms, content areas) live in
 * `routes/_shell/settings/` where they can import from `entities/` and
 * `widgets/` without violating the `no-upward-from-shared` rule.
 *
 * This barrel exports ONLY pure layout/styling wrappers that have no
 * entity/widget dependencies.
 */

export { DrawerPage } from './DrawerPage';
/** @public */
export type { DrawerPageProps } from './DrawerPage';

export { DrawerPageHeader } from './DrawerPageHeader';
/** @public */
export type { DrawerPageHeaderProps, DrawerPageHeaderSlotProps } from './DrawerPageHeader';

export { SettingsDrawer } from './SettingsDrawer';
/** @public */
export type { SettingsDrawerProps, SettingsTab, SettingsSection } from './SettingsDrawer';

export { SettingsRedirect } from './SettingsRedirect';

export { SETTINGS_LAYOUT } from './settings.constants';

export { DeleteUserButton } from './DeleteUserButton';
/** @public */
export type { DeleteUserButtonProps } from './DeleteUserButton';

export { EditUsersButton } from './EditUsersButton';
/** @public */
export type { EditUsersButtonProps } from './EditUsersButton';

export { EditUserRolesDialog } from './EditUserRolesDialog';
/** @public */
export type { EditUserRolesDialogProps } from './EditUserRolesDialog';

export { InviteUserDialog } from './InviteUserDialog';
/** @public */
export type { InviteUserDialogProps } from './InviteUserDialog';
