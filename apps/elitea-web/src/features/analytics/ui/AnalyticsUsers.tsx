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
import { AnalyticsLoadError } from './components/DetailStatus';
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
 *
 * `dateFrom`/`dateTo` are applied client-side against each row's
 * `last_active_at` (see `isWithinDateRange` below) — the server itself
 * ignores the date params for this list endpoint (`api/useAnalytics.ts`'s
 * header), so without this filter the date-range picker would have no
 * observable effect here either, the same defect this unit fixed on the
 * Agents/Tools tabs' error-rate display but could NOT fix for those tabs'
 * date filtering (see `AnalyticsAgents.tsx`/`AnalyticsTools.tsx`'s list-query
 * doc comments) because those rows carry no per-row timestamp to filter by.
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

/**
 * `true` when `lastActiveAt` (a row's `last_active_at`, ISO 8601 with
 * offset — `UserActivity`'s zod schema) falls within `[from, to]` (also
 * ISO 8601 — `model/dateRange.ts`'s `toIsoRange` is what produces the
 * `dateFrom`/`dateTo` props this component receives). Local to this file
 * rather than imported from `../model/dateRange`: this cluster's file scope
 * is `ui/AnalyticsUsers.tsx` only, and the comparison itself is too small
 * to justify reaching outside it.
 *
 * Unlike the Agents/Tools tabs (see the doc comments on
 * `AnalyticsAgents.tsx`/`AnalyticsTools.tsx`'s own list-query call sites),
 * the Users tab CAN be fixed entirely client-side: `UserActivity` genuinely
 * carries a per-row timestamp the list response already returns, so
 * filtering the already-fetched rows down to the picker's range is a real
 * fix for "the date-range picker has no effect on this tab" — it needs no
 * backend change. (`useAnalyticsUsersListQuery` still sends `date_from`/
 * `date_to` on the wire too, for parity with the other list calls, but per
 * `api/useAnalytics.ts`'s header the server itself ignores it and always
 * returns the full set — this filter is what actually makes the range
 * effective.)
 */
function isWithinDateRange(lastActiveAt: string, from: string, to: string): boolean {
  const time = new Date(lastActiveAt).getTime();
  return time >= new Date(from).getTime() && time <= new Date(to).getTime();
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

  const { data, isFetching, isError } = useAnalyticsUsersListQuery(projectId, { dateFrom, dateTo });
  // See `isWithinDateRange`'s doc comment: the server ignores `date_from`/
  // `date_to` for this list endpoint, so this filter is what makes the
  // date-range picker actually take effect on this tab.
  const items = useMemo(
    () => (data?.items ?? []).filter((row) => isWithinDateRange(row.last_active_at, dateFrom, dateTo)),
    [data, dateFrom, dateTo],
  );

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

  // See `AnalyticsAgents.tsx`'s identical guard. The placement is
  // load-bearing HERE in particular: this tab can be entered already inside
  // the drill-down (`initialUserId`, from the Overview leaderboard), and the
  // only way back out is `AnalyticsUserDetailed`'s Back button. Checking
  // `isError` BEFORE the `selectedUser` branch above would replace that
  // screen — and its Back button — with a bare error message, stranding the
  // user mid-drill-down over a failure of the LIST query they are not even
  // looking at. The detail screen runs its own query and surfaces its own
  // failure.
  if (isError) {
    return <AnalyticsLoadError />;
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
