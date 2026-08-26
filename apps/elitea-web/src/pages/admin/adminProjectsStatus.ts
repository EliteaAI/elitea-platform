/**
 * How a project's `status` renders — the chip colour and the human label.
 *
 * One module because two surfaces read it: `AdminProjectsTable`'s chip and
 * `adminProjectsCsv`'s Status column. A second copy of the switch is how the
 * exported file and the screen start disagreeing about the same row.
 *
 * `status` is a real server field derived from `suspended` and
 * `create_success` — unlike the admin Users reference page's `status`, which
 * no response has ever carried.
 */
import { t } from '@/shared/i18n';

import type { ProjectStatus } from './api/adminProjectsApi';

export const PROJECT_STATUS_COLOUR: Record<ProjectStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  suspended: 'warning',
  failed: 'error',
};

export function projectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'suspended':
      return t('pages.admin.projects.status.suspended', 'Suspended');
    case 'failed':
      return t('pages.admin.projects.status.failed', 'Failed');
    case 'active':
      return t('pages.admin.projects.status.active', 'Active');
  }
}
