/**
 * Row shaping for the Admin › Projects export — the Users export's twin, on
 * the same `./adminCsv` primitives (quoting, formula guard, BOM, paged walk).
 *
 * The columns are the reference page's `EXPORT_COLUMNS`
 * (`frontends/admin_ui/.../ProjectsPage.jsx`), including its `admin_names`
 * join. `status` is the server's own derived field, rendered through
 * `./adminProjectsStatus` — the same labels `AdminProjectsTable` puts in its
 * chip, so the file and the screen cannot disagree.
 */
import { t } from '@/shared/i18n';

import { toCsvDocument } from './adminCsv';
import { projectStatusLabel } from './adminProjectsStatus';
import type { AdminProjectRow } from './api/adminProjectsApi';

/** `rows` → a CSV document, header included. */
export function buildAdminProjectsCsv(rows: readonly AdminProjectRow[]): string {
  const header = [
    t('pages.admin.projects.column.name', 'Name'),
    t('pages.admin.projects.column.id', 'ID'),
    t('pages.admin.projects.column.owner', 'Owner'),
    t('pages.admin.projects.column.admins', 'Admins'),
    t('pages.admin.projects.column.status', 'Status'),
  ];
  return toCsvDocument(
    header,
    rows.map((row) => [
      row.name,
      String(row.id),
      row.owner_name,
      row.admin_names.join(', '),
      projectStatusLabel(row.status),
    ]),
  );
}
