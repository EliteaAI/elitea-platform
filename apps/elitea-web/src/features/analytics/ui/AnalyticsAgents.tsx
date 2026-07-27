import { memo, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Bar, BarChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import type { AgentAnalytics } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { combineSx } from '@/shared/ui/lib/combineSx';

import { useAnalyticsAgentsListQuery } from '../api/useAnalytics';
import { pickChartColor } from '../lib/constants';
import { fmtDuration, fmtNum, UNAVAILABLE_METRIC } from '../lib/format';
import { AnalyticsAgentDetailed } from './AnalyticsAgentDetailed';
import { ChartTooltip } from './components/ChartTooltip';
import { renderColoredBar } from './components/coloredBarShape';
import { PaginatedEntityTable } from './components/PaginatedEntityTable';
import type { EntityTableColumn } from './components/PaginatedEntityTable';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/analytics/ui/AnalyticsAgents.jsx`.
 *
 * Field mapping vs. the baseline (see `api/useAnalytics.ts`'s header and
 * this unit's final report): the real `AgentAnalytics` list row
 * (`application_id`, `name`, `run_count`, `avg_duration_ms`,
 * `total_tokens`, `error_rate`) has neither the baseline's `entity_id`/
 * `entity_name`/`events`/`users`/`errors` field names NOR a `total` count
 * or `chat_daily` series on the list envelope (`AnalyticsAgentsList` is
 * strictly `{items: AgentAnalytics[]}` — no other key exists on it in any
 * form, unlike `health`/`top_ai_users`, which are real if currently-empty
 * fields). The "Chat Messages" chart is therefore dropped, not ported dead:
 * there is no field on this response `chat_daily` could ever read.
 */
export interface AnalyticsAgentsProps {
  readonly projectId: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
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

function matchesSearch(row: AgentAnalytics, query: string): boolean {
  return row.name.toLowerCase().includes(query.toLowerCase());
}

function AnalyticsAgentsImpl({ projectId, dateFrom, dateTo }: AnalyticsAgentsProps): ReactNode {
  const theme = useTheme();
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);

  const { data, isFetching } = useAnalyticsAgentsListQuery(projectId, { dateFrom, dateTo });
  const items = useMemo(() => data?.items ?? [], [data]);

  const chartData = useMemo(
    () =>
      items.slice(0, 20).map((agent, index) => ({
        name: agent.name,
        events: agent.run_count,
        color: pickChartColor(index),
      })),
    [items],
  );

  const handleBack = useCallback(() => setSelectedApplicationId(null), []);

  if (selectedApplicationId !== null) {
    return (
      <AnalyticsAgentDetailed
        projectId={projectId}
        applicationId={selectedApplicationId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onBack={handleBack}
      />
    );
  }

  const columns: readonly EntityTableColumn[] = [
    {
      header: t('analytics.agents.columnAgent', 'Agent'),
      flex: 3,
      render: (row) => (
        <Typography
          noWrap
          sx={cellSx}
        >
          {String(row['name'])}
        </Typography>
      ),
    },
    {
      header: t('analytics.agents.columnEvents', 'Events'),
      flex: 1,
      render: (row) => <Typography sx={cellSx}>{fmtNum(row['run_count'] as number)}</Typography>,
    },
    {
      header: t('analytics.agents.columnUsers', 'Users'),
      flex: 1,
      render: () => <Typography sx={cellSx}>{UNAVAILABLE_METRIC}</Typography>,
    },
    {
      header: t('analytics.agents.columnAvgLatency', 'Avg Latency'),
      flex: 1,
      render: (row) => <Typography sx={cellSx}>{fmtDuration(row['avg_duration_ms'] as number)}</Typography>,
    },
    {
      header: t('analytics.agents.columnErrors', 'Errors'),
      flex: 1,
      render: (row) => {
        const errorRate = row['error_rate'] as number;
        return (
          <Typography
            sx={combineSx(cellSx, { color: errorRate > 0 ? theme.vars.palette.status.rejected : undefined })}
          >
            {errorRate}%
          </Typography>
        );
      },
    },
  ];

  return (
    <Box sx={contentSx}>
      {chartData.length > 0 && (
        <Box sx={cardSx}>
          <Typography
            variant="labelMedium"
            sx={titleSx}
          >
            {t('analytics.agents.chartTitle', 'Most Active Agents')}
          </Typography>
          <Typography
            variant="bodySmall"
            sx={subtitleSx}
          >
            {t('analytics.agents.chartSubtitle', 'Top {{count}} by events', { count: chartData.length })}
          </Typography>
          <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
            <ResponsiveContainer
              width="100%"
              height={200}
            >
              <BarChart
                data={chartData}
                margin={{ left: 5, right: 20, top: 5, bottom: 40 }}
              >
                <XAxis
                  dataKey="name"
                  tick={{ fill: theme.vars.palette.text.primary, fontSize: theme.typography.labelTiny.fontSize }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                  height={50}
                  axisLine={{ stroke: theme.vars.palette.text.primary }}
                  tickLine={{ stroke: theme.vars.palette.text.primary }}
                />
                <YAxis
                  tick={{ fill: theme.vars.palette.text.primary, fontSize: theme.typography.labelSmall.fontSize }}
                  axisLine={{ stroke: theme.vars.palette.text.primary }}
                  tickLine={{ stroke: theme.vars.palette.text.primary }}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="events"
                  name={t('analytics.agents.chartSeriesEvents', 'Events')}
                  radius={[4, 4, 0, 0]}
                  shape={renderColoredBar}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
      <Box sx={cardSx}>
        <Typography
          variant="labelMedium"
          sx={titleSx}
        >
          {t('analytics.agents.tableTitle', 'Agent Activity')}
        </Typography>
        <Typography
          variant="bodySmall"
          sx={subtitleSx}
        >
          {t('analytics.agents.tableSubtitle', '{{count}} agents', { count: items.length })}
        </Typography>
        <PaginatedEntityTable
          rows={items}
          isFetching={isFetching}
          columns={columns}
          rowKey={(row, index) => `${String(row['application_id'])}-${index}`}
          searchPlaceholder={t('analytics.agents.searchPlaceholder', 'Search by agent name')}
          searchFilter={(row, query) => matchesSearch(row as unknown as AgentAnalytics, query)}
          onRowClick={(row) => setSelectedApplicationId(String(row['application_id']))}
        />
      </Box>
    </Box>
  );
}

export const AnalyticsAgents = memo(AnalyticsAgentsImpl);
