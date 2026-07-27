import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { UserActivity } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { useAnalyticsUsersListQuery } from '../api/useAnalytics';
import { fmtNum, UNAVAILABLE_METRIC } from '../lib/format';
import { AnalyticsUserDetailed } from './AnalyticsUserDetailed';
import { PaginatedEntityTable } from './components/PaginatedEntityTable';
import type { EntityTableColumn } from './components/PaginatedEntityTable';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsUsers.jsx`. See
 * `AnalyticsAgents.tsx`'s header for the general field-mapping rationale.
 * `UserActivity` (`user_id`, `email`, `run_count`, `last_active_at`) has
 * only two of the baseline's eight columns' worth of real data — `User`
 * (`email`) and `Events` (`run_count`). The other six (`Days`/`LLM`/
 * `Tool`/`Agent`/`Chat Msg`/`Errors`) have no per-type-breakdown or
 * active-day field anywhere on this type; their headers are kept (COPY
 * parity) with `UNAVAILABLE_METRIC` values rather than fabricated numbers.
 */
export interface AnalyticsUsersProps {
  readonly projectId: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
  /** Cross-tab navigation from `AnalyticsOverview`'s leaderboard (baseline: `handleOverviewUserClick`). */
  readonly initialUserId?: string | null;
  readonly onBackToSource?: () => void;
}

const contentSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: (theme: Theme) => theme.spacing(2) };

const cardSx = (theme: Theme) => ({
  padding: theme.spacing(2),
  borderRadius: theme.vars.shape.radiusMd,
  backgroundColor: theme.vars.palette.background.userInputBackground,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

const titleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.secondary,
  marginBottom: theme.spacing(0.5),
  display: 'block',
});

const subtitleSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
  marginBottom: theme.spacing(1),
  display: 'block',
});

const cellSx = (theme: Theme) => ({
  fontSize: theme.typography.bodyMedium.fontSize,
  color: theme.vars.palette.text.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

function matchesSearch(row: UserActivity, query: string): boolean {
  return row.email.toLowerCase().includes(query.toLowerCase());
}

interface SelectedUser {
  readonly userId: string;
  readonly email: string;
}

function AnalyticsUsersImpl({ projectId, dateFrom, dateTo, initialUserId, onBackToSource }: AnalyticsUsersProps): ReactNode {
  const [selectedUser, setSelectedUser] = useState<SelectedUser | null>(
    initialUserId != null ? { userId: initialUserId, email: '' } : null,
  );
  // Captured once at mount (baseline: `useState(() => !!initialUserId)`) —
  // whether "back" should return to the Overview leaderboard or just clear
  // the local in-tab selection.
  const [cameFromExternal] = useState(() => initialUserId != null);

  const { data, isFetching } = useAnalyticsUsersListQuery(projectId, { dateFrom, dateTo });
  const items = useMemo(() => data?.items ?? [], [data]);

  const handleBack = useCallback(() => {
    if (cameFromExternal && onBackToSource !== undefined) {
      onBackToSource();
    } else {
      setSelectedUser(null);
    }
  }, [cameFromExternal, onBackToSource]);

  if (selectedUser !== null) {
    return (
      <AnalyticsUserDetailed
        projectId={projectId}
        userId={selectedUser.userId}
        userEmail={selectedUser.email}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onBack={handleBack}
      />
    );
  }

  const columns: readonly EntityTableColumn[] = [
    {
      header: t('analytics.users.columnUser', 'User'),
      flex: 3,
      render: (row) => {
        const email = String(row['email']);
        return (
          <Typography
            noWrap
            sx={cellSx}
          >
            {email || t('analytics.users.unnamedUser', 'User {{id}}', { id: String(row['user_id']) })}
          </Typography>
        );
      },
    },
    {
      header: t('analytics.users.columnEvents', 'Events'),
      flex: 1,
      render: (row) => <Typography sx={cellSx}>{fmtNum(row['run_count'] as number)}</Typography>,
    },
    {
      header: t('analytics.users.columnDays', 'Days'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.users.columnLlm', 'LLM'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.users.columnTool', 'Tool'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.users.columnAgent', 'Agent'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.users.columnChatMsg', 'Chat Msg'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.users.columnErrors', 'Errors'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
  ];

  return (
    <Box sx={contentSx}>
      <Box sx={cardSx}>
        <Typography
          variant="labelMedium"
          sx={titleSx}
        >
          {t('analytics.users.tableTitle', 'User Activity')}
        </Typography>
        <Typography
          variant="bodySmall"
          sx={subtitleSx}
        >
          {t('analytics.users.tableSubtitle', '{{count}} users', { count: items.length })}
        </Typography>
        <PaginatedEntityTable
          rows={items}
          isFetching={isFetching}
          columns={columns}
          rowKey={(row, index) => `${String(row['user_id'])}-${index}`}
          searchPlaceholder={t('analytics.users.searchPlaceholder', 'Search by email')}
          searchFilter={(row, query) => matchesSearch(row as unknown as UserActivity, query)}
          onRowClick={(row) => setSelectedUser({ userId: String(row['user_id']), email: String(row['email']) })}
        />
      </Box>
    </Box>
  );
}

export const AnalyticsUsers = memo(AnalyticsUsersImpl);
