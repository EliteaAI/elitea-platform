import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import type { UserActivity } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { useAnalyticsUsersListQuery } from '../api/useAnalytics';
import { fmtNum, fmtTimestamp } from '../lib/format';
import { AnalyticsUserDetailed } from './AnalyticsUserDetailed';
import { AnalyticsLoadError } from './components/DetailStatus';
import { PaginatedEntityTable } from './components/PaginatedEntityTable';
import type { EntityTableColumn } from './components/PaginatedEntityTable';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsUsers.jsx`. See
 * `AnalyticsAgents.tsx`'s header for the general field-mapping rationale.
 * ── THE SIX DASH COLUMNS ARE GONE ──
 *
 * `Days`/`LLM`/`Tool`/`Agent`/`Chat Msg`/`Errors` were baseline headers kept
 * for copy parity over cells that rendered `UNAVAILABLE_METRIC` in every row,
 * forever: `UserActivity` carried no per-type breakdown and no active-day
 * count, and the gateway request log this table now reads carries neither
 * either — a request knows its model, not the agent or tool that composed it.
 * Six columns of dashes take three quarters of the table's width to say
 * nothing, and invite every reader to wonder what is broken.
 *
 * What replaced them are two figures the same rows already carry: `Tokens`
 * (prompt + completion) and `Last active`. The remaining columns — `User`
 * (name, or email, or the id), and `LLM calls` (`run_count`) — are unchanged
 * apart from the header, which said `Events` while counting gateway requests.
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

/**
 * A table cell's value as a string, and '' for anything that is not one.
 *
 * `EntityTableColumn.render` receives an untyped row, so `String(row[k])` would
 * happily stringify an object as `[object Object]` — the lint rule that flagged
 * it is right that a display cell should never do that silently.
 */
function strCell(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Matches on everything the User column can DISPLAY, not just on the email.
 *
 * The column renders `name || email || #id`. Searching the email alone made a
 * member whose identity row carries a display name and no email visible in the
 * table and unfindable by typing what the table shows them — the worst kind of
 * search result, because it looks like the row does not exist.
 */
function matchesSearch(row: UserActivity, query: string): boolean {
  const needle = query.toLowerCase();
  return [row.name ?? '', row.email, row.user_id].some((field) => field.toLowerCase().includes(needle));
}

/**
 * `true` when `lastActiveAt` (a row's `last_active_at`, ISO 8601 with
 * offset — `UserActivity`'s zod schema) falls within `[from, to]` (also
 * ISO 8601 — `model/dateRange.ts`'s `toIsoRange` is what produces the
 * `dateFrom`/`dateTo` props this component receives).
 *
 * ── THIS IS A BACKSTOP NOW, NOT THE FIX ──
 *
 * It was written when the server ignored `date_from`/`date_to` on this endpoint
 * and returned the full unfiltered set, which made the date picker inert on
 * this tab; filtering the already-fetched rows was the whole of the fix.
 *
 * That is no longer true. `parseParams` resolves the window and the repository
 * applies it in SQL, so every row that arrives is inside the range by
 * construction — `last_active_at` is a `max(occurred_at)` taken over the window
 * itself. The filter cannot change the result today.
 *
 * It stays because it is a CHEAP INVARIANT rather than dead weight: it costs one
 * comparison per row and it is what keeps the picker honest if the server's
 * window handling ever regresses. What it must NOT do is go on claiming to be
 * the mechanism — a comment that describes a fix the server has since taken
 * over is how the next reader concludes the server still ignores the range.
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

  const { data, isFetching, isError, error } = useAnalyticsUsersListQuery(projectId, { dateFrom, dateTo });
  // A backstop, not the mechanism — see `isWithinDateRange`'s doc comment. The
  // server applies the window in SQL now, so this cannot change the result
  // today.
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
    return <AnalyticsLoadError error={error} />;
  }

  const columns: readonly EntityTableColumn[] = [
    {
      header: t('analytics.users.columnUser', 'User'),
      flex: 3,
      render: (row) => {
        // `||`, not `??`: the server sends an EMPTY STRING for a member whose
        // identity it could not resolve (the identity tables belong to another
        // corpus and can be absent), never null — so `??` would pick the empty
        // string and render a blank cell where the id belongs.
        const label = strCell(row['name']) || strCell(row['email']);
        return (
          <Typography
            noWrap
            sx={cellSx}
          >
            {label || t('analytics.users.unnamedUser', 'User {{id}}', { id: String(row['user_id']) })}
          </Typography>
        );
      },
    },
    {
      header: t('analytics.users.columnEvents', 'LLM calls'),
      flex: 1,
      render: (row) => <Typography sx={cellSx}>{fmtNum(row['run_count'] as number)}</Typography>,
    },
    {
      header: t('analytics.users.columnTokens', 'Tokens'),
      flex: 1,
      render: (row) => <Typography sx={cellSx}>{fmtNum(row['total_tokens'] as number)}</Typography>,
    },
    {
      header: t('analytics.users.columnLastActive', 'Last active'),
      flex: 2,
      render: (row) => (
        <Typography
          noWrap
          sx={cellSx}
        >
          {fmtTimestamp(row['last_active_at'])}
        </Typography>
      ),
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
          {data?.truncated === true
            ? // A CUT LIST MUST NOT READ AS THE WHOLE ONE. The count and the
              // pagination footer below are computed from `items`, which is
              // what arrived rather than what exists; without this the busiest
              // N callers would be presented as the entire membership, and
              // nothing on screen would suggest otherwise.
              t('analytics.users.tableSubtitleTruncated', 'Top {{count}} users by LLM calls', {
                count: items.length,
              })
            : t('analytics.users.tableSubtitle', '{{count}} users', { count: items.length })}
        </Typography>
        <PaginatedEntityTable
          rows={items}
          isFetching={isFetching}
          columns={columns}
          rowKey={(row, index) => `${String(row['user_id'])}-${index}`}
          searchPlaceholder={t('analytics.users.searchPlaceholder', 'Search users')}
          searchFilter={(row, query) => matchesSearch(row as unknown as UserActivity, query)}
          onRowClick={(row) => setSelectedUser({ userId: String(row['user_id']), email: String(row['email']) })}
        />
      </Box>
    </Box>
  );
}

export const AnalyticsUsers = memo(AnalyticsUsersImpl);
