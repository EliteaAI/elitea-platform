import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { useAnalyticsToolDetailQuery } from '../api/useAnalytics';
import { fmtDuration, fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { AnalyticsKpiRow } from './components/AnalyticsKpiRow';
import { DailyUsageChart } from './components/DailyUsageChart';
import { DetailEmpty, DetailLoading } from './components/DetailStatus';
import { DetailHeader } from './components/DetailHeader';
import { EntityListCard } from './components/EntityListCard';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsToolDetailed.jsx`.
 * Drill-down for a single tool. `toolkitId` (not the baseline's `toolName`)
 * — see `api/useAnalytics.ts`'s header for why: the handler's detail branch
 * needs `tool_id`/`toolkit_id`, and `toolkit_id` is the only one of those
 * two that exists on `ToolAnalytics` (the list row type this screen is
 * always navigated to FROM).
 */
export interface AnalyticsToolDetailedProps {
  readonly projectId: string | undefined;
  readonly toolkitId: string;
  readonly toolName: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly onBack: () => void;
}

const contentSx: SxProps<Theme> = { display: 'flex', flexDirection: 'column', gap: (theme: Theme) => theme.spacing(2) };

const listsGridSx: SxProps<Theme> = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
  gap: (theme: Theme) => theme.spacing(2),
  alignItems: 'stretch',
};

function AnalyticsToolDetailedImpl({
  projectId,
  toolkitId,
  toolName,
  dateFrom,
  dateTo,
  onBack,
}: AnalyticsToolDetailedProps): ReactNode {
  const theme = useTheme();
  const { data, isFetching } = useAnalyticsToolDetailQuery(projectId, toolkitId, { dateFrom, dateTo });

  if (isFetching) return <DetailLoading />;
  if (data === undefined) return <DetailEmpty />;

  const users = data.users ?? [];
  const agents = data.agents ?? [];

  return (
    <Box sx={contentSx}>
      <DetailHeader
        // The Go stub's `entity_name` is always `""` today (see this
        // unit's report) — `toolName`, already known from the row the
        // user clicked, is a strictly-better heading than an empty string.
        entityName={data.entity_name || toolName}
        onBack={onBack}
      />
      <AnalyticsKpiRow kpis={data.kpis} />
      <DailyUsageChart
        title={t('analytics.toolDetail.dailyUsageTitle', 'Daily Usage')}
        rows={data.daily_usage}
        primaryKey="calls"
        primaryLabel={t('analytics.toolDetail.seriesCalls', 'Calls')}
        errorsLabel={t('analytics.toolDetail.seriesErrors', 'Errors')}
      />
      <Box sx={listsGridSx}>
        <EntityListCard
          title={t('analytics.toolDetail.usersTitle', 'Users')}
          subtitle={t('analytics.toolDetail.usersSubtitle', '{{count}} users called this tool', {
            count: users.length,
          })}
          rows={users}
          rowKey={(row, index) => `${strField(row, 'user_id')}-${index}`}
          emptyText={t('analytics.toolDetail.usersEmpty', 'No user data')}
          columns={[
            {
              header: t('analytics.toolDetail.columnUser', 'User'),
              flex: 3,
              render: (row) => {
                const email = strField(row, 'user_email');
                return (
                  <Typography
                    noWrap
                    sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}
                  >
                    {email || t('analytics.toolDetail.unnamedUser', 'User {{id}}', { id: strField(row, 'user_id') })}
                  </Typography>
                );
              },
            },
            {
              header: t('analytics.toolDetail.columnCalls', 'Calls'),
              flex: 1,
              render: (row) => (
                <Typography sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}>
                  {fmtNum(numField(row, 'calls'))}
                </Typography>
              ),
            },
            {
              header: t('analytics.toolDetail.columnAvgLatency', 'Avg Latency'),
              flex: 1,
              render: (row) => (
                <Typography sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}>
                  {fmtDuration(numField(row, 'avg_duration_ms'))}
                </Typography>
              ),
            },
            {
              header: t('analytics.toolDetail.columnErrors', 'Errors'),
              flex: 1,
              render: (row) => {
                const errors = numField(row, 'errors');
                return (
                  <Typography
                    sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: errors > 0 ? theme.vars.palette.status.rejected : theme.vars.palette.text.secondary }}
                  >
                    {errors}
                  </Typography>
                );
              },
            },
          ]}
        />
        <EntityListCard
          title={t('analytics.toolDetail.agentsTitle', 'Agents')}
          subtitle={t('analytics.toolDetail.agentsSubtitle', '{{count}} agents used this tool', {
            count: agents.length,
          })}
          rows={agents}
          rowKey={(row, index) => `${strField(row, 'entity_name')}-${index}`}
          emptyText={t('analytics.toolDetail.agentsEmpty', 'No agent data')}
          columns={[
            {
              header: t('analytics.toolDetail.columnAgent', 'Agent'),
              flex: 3,
              render: (row) => (
                <Typography
                  noWrap
                  sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}
                >
                  {strField(row, 'entity_name')}
                </Typography>
              ),
            },
            {
              header: t('analytics.toolDetail.columnCalls', 'Calls'),
              flex: 1,
              render: (row) => (
                <Typography sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}>
                  {fmtNum(numField(row, 'calls'))}
                </Typography>
              ),
            },
          ]}
        />
      </Box>
    </Box>
  );
}

export const AnalyticsToolDetailed = memo(AnalyticsToolDetailedImpl);
