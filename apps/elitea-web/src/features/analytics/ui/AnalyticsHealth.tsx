import { memo } from 'react';
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';

import type { AnalyticsHealth as AnalyticsHealthData } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';

import { fmtNum } from '../lib/format';
import { ChartTooltip } from './components/ChartTooltip';
import { ErrorCodeTable, ModelHealthTable } from './components/HealthTables';

/**
 * The Health tab.
 *
 * ── IT COULD NEVER RENDER ANYTHING ──
 *
 * Two independent defects made this component's entire body unreachable for its
 * whole life, and each hid the other:
 *
 *  1. `AnalyticsTabContent` rendered `<AnalyticsHealth dailyActivity={…} />` and
 *     NEVER passed `health`. It defaulted to `[]` and the component returned
 *     "No health data available." on `health.length === 0`, so every branch
 *     below that guard was dead. There was nothing to pass: `ProjectAnalytics`
 *     had no `health` field in the spec or in the Go handler, and neither did
 *     the baseline SPA's response — this was ported faithfully, including the
 *     part that never worked.
 *  2. The trend chart read `errors` and `events` off each daily point through
 *     the loose readers. Neither field has ever existed on any response, so
 *     every point would have been `0` even had the chart been reachable — a
 *     flat line at zero, which reads as "nothing failed" rather than as a bug.
 *
 * ── WHAT MAKES IT ANSWERABLE NOW ──
 *
 * `gateway.llm_request_logs` (shared migration 0099) is the only table in this
 * platform that records a request that FAILED. The billing ledger is written
 * from a billing delta, and a delta rides only a BILLED request, so a call
 * refused by a budget, rejected by a policy, addressed to an unresolvable model
 * or failed upstream never reaches it — a health view built over the ledger
 * would list successes and no failures, the opposite of what this tab is for.
 *
 * The loose `numField`/`strField` readers are gone, as they went from
 * `AnalyticsOverview`. They were not merely unnecessary: reading a field that
 * does not exist through them yields `0`, so the compiler could not see either
 * defect above and neither could a test that only checked the component
 * rendered.
 *
 * ── WHAT IT STILL CANNOT SHOW ──
 *
 * The old table was "Health by Event Type", over an `event_type` column of
 * `centry.audit_events` — a table this service cannot write and does not read.
 * There is no event-type dimension in the request log and none is invented
 * here; the table is keyed by (provider, model, streaming) instead, which is
 * what the data source actually has.
 */
export interface AnalyticsHealthProps {
  /**
   * Absent when the repository could not build the block. An idle project has a
   * health object with zero totals, which is a different and true statement —
   * so this renders "no data" only for the first case, and real zeros for the
   * second.
   */
  readonly health?: AnalyticsHealthData | undefined;
}

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

const emptyStateSx = (theme: Theme) => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: theme.spacing(8),
});

const emptyTextSx = (theme: Theme) => ({ color: theme.vars.palette.text.metrics });

const totalsRowSx = (theme: Theme) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: theme.spacing(2),
});

const totalLabelSx = (theme: Theme) => ({
  color: theme.vars.palette.text.metrics,
  fontSize: theme.typography.labelSmall.fontSize,
});





/**
 * The KPI strip. Three figures, and each is a count the request log measured
 * rather than a rate derived from something else.
 */
function HealthTotals({ health }: { readonly health: AnalyticsHealthData }): ReactNode {
  const theme = useTheme();
  const danger = health.error_rate > 5;
  return (
    <Box sx={totalsRowSx}>
      <Box sx={cardSx}>
        <Typography variant="labelSmall" sx={totalLabelSx}>
          {t('analytics.health.totalRequests', 'REQUESTS')}
        </Typography>
        <Typography variant="headingMedium">{fmtNum(health.requests)}</Typography>
      </Box>
      <Box sx={cardSx}>
        <Typography variant="labelSmall" sx={totalLabelSx}>
          {t('analytics.health.totalErrors', 'ERRORS')}
        </Typography>
        <Typography
          variant="headingMedium"
          sx={{ color: health.errors > 0 ? theme.vars.palette.status.rejected : undefined }}
        >
          {fmtNum(health.errors)}
        </Typography>
      </Box>
      <Box sx={cardSx}>
        <Typography variant="labelSmall" sx={totalLabelSx}>
          {t('analytics.health.totalErrorRate', 'ERROR RATE')}
        </Typography>
        <Typography
          variant="headingMedium"
          sx={{ color: danger ? theme.vars.palette.status.rejected : undefined }}
        >
          {`${health.error_rate.toFixed(1)}%`}
        </Typography>
      </Box>
    </Box>
  );
}

function AnalyticsHealthImpl({ health }: AnalyticsHealthProps): ReactNode {
  const theme = useTheme();
  const axisStroke = theme.vars.palette.text.primary;
  const axisTickStyle = { fill: axisStroke, fontSize: theme.typography.labelSmall.fontSize };

  // ABSENT, not empty. An idle project has a health object whose totals are
  // zero — a real measurement — and only a repository that could not build the
  // block leaves it undefined.
  if (health === undefined) {
    return (
      <Box sx={emptyStateSx}>
        <Typography
          variant="bodyMedium"
          sx={emptyTextSx}
        >
          {t('analytics.health.empty', 'No health data available.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: theme.spacing(2) }}>
      <HealthTotals health={health} />
      {health.daily.length > 0 && (
        <Box sx={cardSx}>
          <Typography
            variant="labelMedium"
            sx={titleSx}
          >
            {t('analytics.health.chartTitle', 'Requests vs Errors')}
          </Typography>
          <Typography
            variant="bodySmall"
            sx={subtitleSx}
          >
            {t('analytics.health.chartSubtitle', 'Total requests trend with error overlay')}
          </Typography>
          <Box sx={{ width: '100%', overflow: 'hidden', flex: 1, minHeight: 200 }}>
            <ResponsiveContainer
              width="100%"
              height={240}
            >
              {/*
                The series are `requests` and `errors`, which the response
                actually carries. They used to be `events` and `users`, read
                loosely off a daily point that has never had either — so every
                point resolved to 0 and the chart, had it ever been reachable,
                would have drawn a flat line at zero. A flat line at zero reads
                as "nothing failed", which is why the compiler seeing these
                names matters more here than almost anywhere else in the tab.
              */}
              <AreaChart data={[...health.daily]}>
                <XAxis
                  dataKey="date"
                  tick={axisTickStyle}
                  tickFormatter={(value: string) => value.slice(5)}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={{ stroke: axisStroke }}
                />
                <YAxis
                  yAxisId="requests"
                  tick={axisTickStyle}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={{ stroke: axisStroke }}
                />
                <YAxis
                  yAxisId="errors"
                  orientation="right"
                  tick={axisTickStyle}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={{ stroke: axisStroke }}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Area
                  yAxisId="requests"
                  type="monotone"
                  dataKey="requests"
                  name={t('analytics.health.seriesTotalRequests', 'Total Requests')}
                  stroke={theme.vars.palette.status.draft}
                  fill={theme.vars.palette.status.draft}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
                <Area
                  yAxisId="errors"
                  type="monotone"
                  dataKey="errors"
                  name={t('analytics.health.seriesErrors', 'Errors')}
                  stroke={theme.vars.palette.status.rejected}
                  fill={theme.vars.palette.status.rejected}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </Box>
      )}
      <ErrorCodeTable health={health} />
      <ModelHealthTable health={health} />
    </Box>
  );
}

export const AnalyticsHealth = memo(AnalyticsHealthImpl);
