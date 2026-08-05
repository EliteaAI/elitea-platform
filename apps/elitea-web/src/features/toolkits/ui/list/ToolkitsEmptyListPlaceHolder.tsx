import type { ReactNode } from 'react';

import Box from '@mui/material/Box';

import { t } from '@/shared/i18n';
import { CollectionStatus } from '@/shared/lib/sort-status';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/list/
 * ToolkitsEmptyListPlaceHolder.jsx` (Wave-2 unit A4e) — the per-status
 * "you have no X" message shown inside `ToolkitsList` when the current
 * filter/search yields zero rows.
 */
export interface ToolkitsEmptyListPlaceHolderProps {
  readonly query?: string;
  readonly status?: string;
  readonly isMCP?: boolean;
}

function emptyMessage(entityName: string, status: string | undefined): string {
  switch (status) {
    case CollectionStatus.UserApproval:
      return t('features.toolkits.emptyListPlaceHolder.userApproval', 'You have no approval {{entityName}}.', { entityName });
    case CollectionStatus.Draft:
      return t('features.toolkits.emptyListPlaceHolder.draft', 'You have no draft {{entityName}}.', { entityName });
    case CollectionStatus.OnModeration:
      return t('features.toolkits.emptyListPlaceHolder.onModeration', 'You have no {{entityName}} on moderation.', { entityName });
    case CollectionStatus.Rejected:
      return t('features.toolkits.emptyListPlaceHolder.rejected', 'You have no rejected {{entityName}}.', { entityName });
    case CollectionStatus.Published:
      return t('features.toolkits.emptyListPlaceHolder.published', 'You have no published {{entityName}}.', { entityName });
    case undefined:
    default:
      return t('features.toolkits.emptyListPlaceHolder.default', 'You have no {{entityName}}.', { entityName });
  }
}

export function ToolkitsEmptyListPlaceHolder({ query, status, isMCP = false }: ToolkitsEmptyListPlaceHolderProps): ReactNode {
  const entityName = isMCP ? 'MCPs' : 'toolkits';

  if (query) {
    return (
      <Box>
        {t('features.toolkits.emptyListPlaceHolder.nothingFoundLeading', 'Nothing found.')} <br />
        {t('features.toolkits.emptyListPlaceHolder.nothingFoundTrailing', 'Create yours now!')}
      </Box>
    );
  }

  return <Box>{emptyMessage(entityName, status)}</Box>;
}
