import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { useAnalyticsAgentDetailQuery } from '../api/useAnalytics';
import { fmtDuration, fmtNum } from '../lib/format';
import { numField, strField } from '../lib/looseRecord';
import { AnalyticsKpiRow } from './components/AnalyticsKpiRow';
import { DailyUsageChart } from './components/DailyUsageChart';
import { DetailEmpty, DetailLoading } from './components/DetailStatus';
import { DetailHeader } from './components/DetailHeader';
import { EntityListCard } from './components/EntityListCard';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsAgentDetailed.jsx`.
 * Drill-down for a single agent: KPIs (`AnalyticsKpiRow`, the real
 * `AnalyticsKpis` shape — see that component's header for why this is NOT
 * the baseline's `total_events`/`avg_duration_ms`/`errors`/`error_rate`
 * card set, none of which exist on the real backend response), daily-usage
 * chart, and the users/tools that interacted with it.
 */
export interface AnalyticsAgentDetailedProps {
  readonly projectId: string | undefined;
  readonly applicationId: string;
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

function AnalyticsAgentDetailedImpl({
  projectId,
  applicationId,
  dateFrom,
  dateTo,
  onBack,
}: AnalyticsAgentDetailedProps): ReactNode {
  const theme = useTheme();
  const { data, isFetching } = useAnalyticsAgentDetailQuery(projectId, applicationId, { dateFrom, dateTo });

  if (isFetching) return <DetailLoading />;
  if (data === undefined) return <DetailEmpty />;

  const users = data.users ?? [];
  const tools = data.tools ?? [];

  return (
    <Box sx={contentSx}>
      <DetailHeader
        entityName={data.entity_name}
        onBack={onBack}
      />
      <AnalyticsKpiRow kpis={data.kpis} />
      <DailyUsageChart
        title={t('analytics.agentDetail.dailyUsageTitle', 'Daily Usage')}
        rows={data.daily_usage}
        primaryKey="events"
        primaryLabel={t('analytics.agentDetail.seriesEvents', 'Events')}
        errorsLabel={t('analytics.agentDetail.seriesErrors', 'Errors')}
      />
      <Box sx={listsGridSx}>
        <EntityListCard
          title={t('analytics.agentDetail.usersTitle', 'Users')}
          subtitle={t('analytics.agentDetail.usersSubtitle', '{{count}} users used this agent', {
            count: users.length,
          })}
          rows={users}
          rowKey={(row, index) => `${strField(row, 'user_id')}-${index}`}
          emptyText={t('analytics.agentDetail.usersEmpty', 'No user data')}
          columns={[
            {
              header: t('analytics.agentDetail.columnUser', 'User'),
              flex: 3,
              render: (row) => {
                const email = strField(row, 'user_email');
                return (
                  <Typography
                    noWrap
                    sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}
                  >
                    {email || t('analytics.agentDetail.unnamedUser', 'User {{id}}', { id: strField(row, 'user_id') })}
                  </Typography>
                );
              },
            },
            {
              header: t('analytics.agentDetail.columnEvents', 'Events'),
              flex: 1,
              render: (row) => (
                <Typography sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}>
                  {fmtNum(numField(row, 'events'))}
                </Typography>
              ),
            },
            {
              header: t('analytics.agentDetail.columnAvgLatency', 'Avg Latency'),
              flex: 1,
              render: (row) => (
                <Typography sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}>
                  {fmtDuration(numField(row, 'avg_duration_ms'))}
                </Typography>
              ),
            },
            {
              header: t('analytics.agentDetail.columnErrors', 'Errors'),
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
          title={t('analytics.agentDetail.toolsTitle', 'Tools')}
          subtitle={t('analytics.agentDetail.toolsSubtitle', '{{count}} tools used by this agent', {
            count: tools.length,
          })}
          rows={tools}
          rowKey={(row, index) => `${strField(row, 'tool_name')}-${index}`}
          emptyText={t('analytics.agentDetail.toolsEmpty', 'No tool data')}
          columns={[
            {
              header: t('analytics.agentDetail.columnTool', 'Tool'),
              flex: 3,
              render: (row) => (
                <Typography
                  noWrap
                  sx={{ fontSize: theme.typography.bodyMedium.fontSize, color: theme.vars.palette.text.secondary }}
                >
                  {strField(row, 'tool_name')}
                </Typography>
              ),
            },
            {
              header: t('analytics.agentDetail.columnCalls', 'Calls'),
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

export const AnalyticsAgentDetailed = memo(AnalyticsAgentDetailedImpl);
