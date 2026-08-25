/**
 * Row shaping for the Admin › Users export. Quoting, the formula guard, the
 * BOM and the paged walk all live in `./adminCsv` — shared with the Projects
 * export so the two files cannot drift into two different CSV dialects.
 *
 * The columns and their values are the reference page's `EXPORT_COLUMNS`
 * (`frontends/admin_ui/.../UsersPage.jsx`); only the container format differs.
 */
import { t } from '@/shared/i18n';

import { toCsvDocument } from './adminCsv';
import type { AdminUserRow } from './api/adminUsersApi';

function roleLabel(row: AdminUserRow): string {
  if (row.admin_role === null) return t('pages.admin.users.role.none', 'None');
  const labels: Record<NonNullable<AdminUserRow['admin_role']>, string> = {
    super_admin: t('pages.admin.users.role.superAdmin', 'Super Admin'),
    admin: t('pages.admin.users.role.admin', 'Admin'),
    editor: t('pages.admin.users.role.editor', 'Editor'),
    viewer: t('pages.admin.users.role.viewer', 'Viewer'),
  };
  return labels[row.admin_role];
}

/** `rows` → a CSV document, header included. Same readings as the table. */
export function buildAdminUsersCsv(rows: readonly AdminUserRow[]): string {
  const header = [
    t('pages.admin.users.column.name', 'Name'),
    t('pages.admin.users.column.email', 'Email'),
    t('pages.admin.users.column.lastLogin', 'Last login'),
    t('pages.admin.users.column.status', 'Status'),
    t('pages.admin.users.column.adminRole', 'Admin Role'),
  ];
  return toCsvDocument(
    header,
    rows.map((row) => [
      row.name,
      row.email,
      row.last_login ?? t('pages.admin.users.neverLoggedIn', 'Never'),
      row.suspended
        ? t('pages.admin.users.status.suspended', 'Suspended')
        : t('pages.admin.users.status.active', 'Active'),
      roleLabel(row),
    ]),
  );
}
